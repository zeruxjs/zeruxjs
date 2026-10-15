#!/usr/bin/env node
/** Section 83: package-only integration evidence. Live suites opt in explicitly.
 * Does not start or modify services, email recipients, databases or DNS.
 */
import {spawn} from 'node:child_process';
import {mkdir, open} from 'node:fs/promises';
import {existsSync,readFileSync,constants as fsConstants} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {Socket} from 'node:net';
import {fileURLToPath} from 'node:url';
import {labSuites,parseLabArgs,suiteReadiness,suitesFor,parseTapSummary,testResult,overallStatus,safeReportPath} from './integration-lab-core.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const usage='Usage: node scripts/integration-lab.mjs [--offline|--live|--all] [--build] [--only=sqlite,source] [--require=sqlite] [--dry-run] [--report=relative/path.json]';
let options;
try{options=parseLabArgs(process.argv.slice(2));}catch(err){console.error(`${err.message}\n${usage}`);process.exit(2);}
const probes={
 pg:['ZX_TEST_PG_HOST','ZX_TEST_PG_PORT','127.0.0.1',5432],
 mysql:['ZX_TEST_MYSQL_HOST','ZX_TEST_MYSQL_PORT','127.0.0.1',3306],
 mongo:['ZX_TEST_MONGO_HOST','ZX_TEST_MONGO_PORT','127.0.0.1',27017],
 redis:['LAB_REDIS_HOST','LAB_REDIS_PORT','127.0.0.1',6379],
 s3:['LAB_S3_HOST','LAB_S3_PORT','127.0.0.1',9000],
 smtp:['ZERUX_TEST_SMTP_HOST','ZERUX_TEST_SMTP_PORT','127.0.0.1',465],
 imap:['ZERUX_TEST_IMAP_HOST','ZERUX_TEST_IMAP_PORT','127.0.0.1',993],
 pop3:['ZERUX_TEST_POP3_HOST','ZERUX_TEST_POP3_PORT','127.0.0.1',995]
};
async function tcpProbe(name,env){
 const [hostKey,portKey,fallbackHost,fallbackPort]=probes[name];
 // Only a socket check. The real suite must authenticate and assert behavior.
 const host=env[hostKey]||fallbackHost,port=Number(env[portKey]||fallbackPort);
 if(!Number.isSafeInteger(port)||port<1||port>65535)return false;
 return new Promise(ok=>{
  const socket=new Socket();let settled=false;
  const finish=(success)=>{if(settled)return;settled=true;socket.destroy();ok(success);};
  socket.setTimeout(1800,()=>finish(false));socket.once('error',()=>finish(false));socket.connect(port,host,()=>finish(true));
 });
}
async function execute(command,timeout){
 return new Promise(ok=>{
  const child=spawn(process.execPath,command,{cwd:root,env:{...process.env,NODE_TEST_REPORTER:'tap'},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
  let output='',timedOut=false,spawnError;
  const append=chunk=>{output=(output+String(chunk)).slice(-80000);};
  child.stdout.on('data',append);child.stderr.on('data',append);child.on('error',error=>{spawnError=error.message;});
  const timer=setTimeout(()=>{timedOut=true;try{if(process.platform==='win32')child.kill('SIGKILL');else process.kill(-child.pid,'SIGKILL');}catch{}},timeout);
  child.once('close',(code,signal)=>{clearTimeout(timer);ok({exitCode:code??1,signal:signal??undefined,timedOut,spawnError,tap:parseTapSummary(output)});});
 });
}
const artifactGate={
 auth:['packages/@zeruxjs/auth/dist/index.js','packages/@zeruxjs/security/dist/index.js'],
 sqlite:['packages/@zeruxjs/db-sqllite/dist/index.js','packages/@zeruxjs/analytics/dist/index.js','packages/@zeruxjs/tags/dist/index.js','packages/@zeruxjs/reports/dist/index.js','packages/@zeruxjs/email/dist/index.js'],
 pipeline:['packages/@zeruxjs/auth/dist/index.js','packages/@zeruxjs/db-sqllite/dist/index.js','packages/@zeruxjs/email/dist/index.js','packages/@zeruxjs/tags/dist/index.js','packages/@zeruxjs/reports/dist/index.js'],
 content:['packages/@zeruxjs/files/dist/index.js','packages/@zeruxjs/media/dist/index.js','packages/@zeruxjs/search/dist/index.js'],
 pg:['packages/@zeruxjs/db-pg/dist/index.js'],mysql:['packages/@zeruxjs/db-mysql/dist/index.js'],mongo:['packages/@zeruxjs/db-mongo/dist/index.js'],
 'redis-cache':['packages/@zeruxjs/cache-redis/dist/index.js'],
 'redis-queue':['packages/@zeruxjs/queue/dist/index.js'],
 'redis-cluster':['packages/@zeruxjs/queue/dist/index.js','packages/@zeruxjs/cache-redis/dist/index.js'],
 s3:['packages/@zeruxjs/files/dist/index.js'],smtp:['packages/@zeruxjs/email/dist/index.js'],imap:['packages/@zeruxjs/email/dist/index.js'],pop3:['packages/@zeruxjs/email/dist/index.js']
};
const buildScopes={auth:['auth','security'],sqlite:['db-sqlite','analytics','tags','reports','email','queue'],pipeline:['auth','db-sqlite','analytics','tags','reports','email'],content:['files','media','search','asset-manager','seo','feed','ai-model'],pg:['db-pg'],mysql:['db-mysql'],mongo:['db-mongo'],'redis-cache':['cache-redis'],'redis-queue':['queue'],'redis-cluster':['cache-redis','queue'],s3:['files'],smtp:['email'],imap:['email'],pop3:['email']};
const plan=suitesFor(options);
const rows=[];
const start=Date.now();
if(!plan.length){console.error('No integration suites selected');process.exit(2);}
let build;
if(options.build&&!options.dryRun){
 const scopes=[...new Set(plan.flatMap(s=>buildScopes[s.id]??[]))].sort();
 if(scopes.length){
  console.log(`[lab] Building ${scopes.length} workspace scope(s) before testing`);
  const compiled=await execute(['scripts/build-workspaces.mjs',...scopes.flatMap(scope=>['--scope',`@zeruxjs/${scope}`]),'--verify'],600000);
  build={status:compiled.exitCode===0?'passed':'failed',scopes};
  console.log(`[lab] Build ${build.status.toUpperCase()} (full clean npm ci is a separate gate)`);
 }
}
for(const suite of plan){
 let status='planned',reason,summary,elapsedMs=0;
 const readiness=suiteReadiness(suite,process.env);
 if(!options.dryRun){
  if(!readiness.ready){status='skipped';reason=`Missing opt-in/configuration: ${readiness.missing.join(', ')}`;}
  else if((artifactGate[suite.id]??[]).some(path=>!existsSync(resolve(root,path)))){status='blocked';reason='Required built workspace artifacts unavailable; run npm ci and/or --build';}
  else if(suite.probe&&!(await tcpProbe(suite.probe,process.env))){status='skipped';reason=`Service socket not reachable: ${suite.probe} (authentication not attempted)`;}
  else{
   const started=Date.now();
   const run=await execute(suite.command,suite.timeout);
   elapsedMs=Date.now()-started;
   status=testResult(run.exitCode,run.tap);
   summary=run.tap??undefined;
   if(run.timedOut)reason='Suite timed out';
   else if(run.spawnError)reason='Failed to start node test process';
   else if(status==='failed')reason=`Suite exit ${run.exitCode}; ${run.tap?`${run.tap.failed} failed / ${run.tap.passed} passed`:'no valid TAP pass summary'}`;
   // An entirely skipped test file can never be treated as a successful live test.
   if(run.tap?.passed===0 && run.tap?.skipped>0 && run.exitCode===0){status='skipped';reason='All tests skipped by their opt-in gates';}
  }
 }
 const row={id:suite.id,kind:suite.kind,status,elapsedMs,...(reason?{reason}:{}),...(summary?{counts:summary}:{})};
 rows.push(row);
 console.log(`[lab] ${status.toUpperCase()} ${suite.id}${reason?` — ${reason}`:''}${summary?` (${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped)`:''}`);
}
const status=options.dryRun?'planned':build?.status==='failed'?'failed':overallStatus(rows,options.required);
const fixtureHash=createHash('sha256').update(readFileSync(resolve(root,'integration-lab/compose.yml'))).digest('hex');
const report={schema:'zerux-package-integration-lab/v1',section:83,mode:options.mode,createdAt:new Date().toISOString(),runtime:{node:process.version,platform:process.platform,arch:process.arch},scope:'packages-only; no AIO deployment certified',fixtureDefinitionSha256:fixtureHash,status,required:options.required,...(build?{build}:{}),durationMs:Date.now()-start,suites:rows};
try{
 const dest=safeReportPath(root,options.report);
 if(dest){
  await mkdir(dirname(dest),{recursive:true});
  // O_NOFOLLOW closes a leaf-symlink swap between validation and opening.
  const file=await open(dest,fsConstants.O_WRONLY|fsConstants.O_CREAT|fsConstants.O_TRUNC|fsConstants.O_NOFOLLOW,0o600);
  try{await file.chmod(0o600);await file.writeFile(JSON.stringify(report,null,2)+'\n');}finally{await file.close();}
  console.log(`[lab] Evidence report: ${options.report}`);
 }
}catch(error){console.error(`[lab] Cannot write report: ${error.message}`);process.exitCode=1;}
console.log(`[lab] ${status.toUpperCase()} (${rows.filter(x=>x.status==='passed').length}/${rows.length} suite(s) passed; skipped/unavailable suites are not certified)`);
if(status==='failed'||status==='incomplete'||status==='partial')process.exitCode=1;
