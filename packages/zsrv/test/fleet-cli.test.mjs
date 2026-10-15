import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { SlidingRestartBudget } from '../dist/portless/restart-budget.js';
import { parseFleetRunArguments } from '../dist/bin/parse-fleet.js';
import { createFleetCheckpointWriter, readFleetCheckpoint, fingerprintFleetConfig, fleetStatePath } from '../dist/portless/fleet-state.js';
import { processIdentity } from '../dist/portless/lifecycle.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePorts(n) {
 const servers = Array.from({length:n},()=>net.createServer());
 try {
  await Promise.all(servers.map(s=>new Promise(r=>s.listen(0,'127.0.0.1',r))));
  return servers.map(s=>s.address().port);
 } finally {await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));}
}
function runner(argv, env) {
 const child=spawn(process.execPath,argv,{env,stdio:['ignore','pipe','pipe']});
 let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',part=>logs+=part.toString());
 return {child,get logs(){return logs},async end(){
  if(child.exitCode===null)child.kill('SIGTERM');
  let timer;await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>{timer=setTimeout(r,2000);})]);clearTimeout(timer);
  if(child.exitCode===null)child.kill('SIGKILL');
 }};
}
async function cli(bin,env,args) {
 const proc=runner([bin,...args],env);
 let timer;const result=await Promise.race([new Promise(r=>proc.child.once('exit',r)),new Promise(r=>timer=setTimeout(()=>r('timeout'),25000))]);
 clearTimeout(timer);
 if(result==='timeout'){await proc.end();throw Error('CLI timeout: '+args.join(' ')+' '+proc.logs);}
 return {code:result,output:proc.logs};
}
async function poll(fn,ms=10000){
 const until=Date.now()+ms;let error;
 while(Date.now()<until){try{const r=await fn();if(r)return r;}catch(e){error=e;}await delay(75);}
 throw Error('Poll timed out: '+(error?.message??'not ready'));
}
const request=(port,host,route='/')=>new Promise((resolve,reject)=>{
 const req=http.get({host:'127.0.0.1',port,path:route,headers:{Host:host,Connection:'close'}},res=>{
 let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.once('end',()=>resolve({status:res.statusCode,body}));});req.once('error',reject);
});
const appCode=String.raw`
const fs=require('node:fs');const http=require('node:http');const port=Number(process.env.PORT);
const server=http.createServer((req,res)=>{
 if(req.url==='/health'){res.statusCode=fs.existsSync(process.env.FAIL_DIR+'/fail-'+port)?503:200;res.end('health');return;}
 res.end(String(port));
});server.listen(port,'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`;

test('fleet CLI validates flags, replica capacity and leaves application argv untouched',()=>{
 const base=['--name','api','--ports','4300,4301,4302','--replicas','2'];
 const parsed=parseFleetRunArguments([...base,'--max-replacements','4','--','node','server.js','--port','99']);
 assert.deepEqual(parsed.command,['node','server.js','--port','99']);
 assert.equal(parsed.maxReplacements,4);
 assert.throws(()=>parseFleetRunArguments([...base,'--ports','4400,4401,4402','--','node']),/Repeated/);
 assert.throws(()=>parseFleetRunArguments([...base,'--replicas','3','--','node']),/Repeated/);
 assert.throws(()=>parseFleetRunArguments(['--name','api','--ports','4300,4301,4302','--replicas','3','--','node']),/Usage/);
 assert.throws(()=>parseFleetRunArguments([...base,'--health-path','//evil','--','node']),/health/);
 assert.throws(()=>parseFleetRunArguments([...base,'--bad','10','--','node']),/Unknown/);
});

test('persistent restart budget survives restore and expires old attempts',()=>{
 const a=new SlidingRestartBudget(2,1000,0,100);a.consume();a.consume();
 const b=new SlidingRestartBudget(2,1000,0,100);b.restore(a.snapshot());assert.equal(b.canAttempt(),false);
 const c=new SlidingRestartBudget(2,1000,0,100);c.restore([Date.now()-2000]);assert.equal(c.used,0);
 assert.throws(()=>c.restore([Date.now(),0]),/Invalid/);
});

test('fleet state is private, atomic, protected against corrupt or symlinked checkpoint',()=>{
 const state=fs.mkdtempSync(path.join(os.tmpdir(),'zsrv-fleet-state-'));
 try {
  const name='app.localhost',config=fingerprintFleetConfig(['node','a'],[4200,4201,4202],2,60000);
  const writer=createFleetCheckpointWriter(state,name,config,processIdentity(process.pid));
  const status={phase:'running',hostname:name,desiredReplicas:2,generation:2,replacementAttempts:1,budgetUsed:1,lastError:null,members:[{port:4200,pid:process.pid,healthy:true,routed:true,failures:0,generation:1}],updatedAt:new Date().toISOString()};
  writer.update(status);writer.attempt([Date.now()]);
  assert.equal(readFleetCheckpoint(state,name).attempts.length,1);
  assert.equal(fs.statSync(fleetStatePath(state,name)).mode & 0o077,0);
  assert.equal(createFleetCheckpointWriter(state,name,config,processIdentity(process.pid)).restoredAttempts.length,1);
  assert.throws(()=>createFleetCheckpointWriter(state,name,'a'.repeat(64),processIdentity(process.pid)),/differs/);
  const file=fleetStatePath(state,name);fs.unlinkSync(file);fs.symlinkSync('/etc/passwd',file);
  assert.throws(()=>readFleetCheckpoint(state,name),/Unsafe/);
  assert.throws(()=>writer.update(status),/Unsafe/);
 }finally{fs.rmSync(state,{recursive:true,force:true});}
});

test('separate proxy and fleet wrapper expose CLI status, reconcile, backend routing and stop', {timeout:80000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zsrv-fleet-cli-'));
 const [proxyPort,a,b,c]=await freePorts(4);
 const bin=new URL('../dist/bin/zerux.js',import.meta.url).pathname;
 const env={...process.env,PORTLESS_PORT:String(proxyPort),PORTLESS_STATE_DIR:dir,FAIL_DIR:dir};
 const proxy=runner([bin,'proxy','start','--port',String(proxyPort)],env);
 let fleet;
 try {
  await poll(async()=>{try{return (await request(proxyPort,'fleet.localhost')).status===404;}catch{return false;}},13000);
  fleet=runner([bin,'fleet','run','--name','fleet','--ports',`${a},${b},${c}`,'--replicas','2',
   '--health-path','/health','--health-interval','30000','--restart-delay','0',
   '--ready-timeout','2500','--shutdown-timeout','900','--','node','-e',appCode],env);
  await poll(async()=>{try{return (await request(proxyPort,'fleet.localhost')).status===200;}catch{return false;}},15000);
  const status=await cli(bin,env,['fleet','status','fleet','--json']);assert.equal(status.code,0,status.output+' '+fleet.logs);
  const parsed=JSON.parse(status.output);assert.equal(parsed.online,true);assert.equal(parsed.members.length,2);
  const backends=await cli(bin,env,['fleet','backends','fleet','--json']);assert.equal(backends.code,0,backends.output);
  assert.equal(JSON.parse(backends.output).length,2);
  fs.writeFileSync(path.join(dir,'fail-'+a),'yes');
  const first=await cli(bin,env,['fleet','reconcile','fleet','--json']);assert.equal(first.code,0,first.output);
  const second=await cli(bin,env,['fleet','reconcile','fleet','--json']);assert.equal(second.code,0,second.output+' '+fleet.logs);
  await poll(async()=>{try{return (await request(proxyPort,'fleet.localhost')).status===200 && JSON.parse((await cli(bin,env,['fleet','status','fleet','--json'])).output).generation>=3;}catch{return false;}},12000);
  const persisted=readFleetCheckpoint(dir,'fleet.localhost');assert.ok(persisted.attempts.length>=1);
  const stopped=await cli(bin,env,['fleet','stop','fleet','--json']);assert.equal(stopped.code,0,stopped.output+' '+fleet.logs);
  await poll(async()=>{try{return (await request(proxyPort,'fleet.localhost')).status===404;}catch{return false;}});
  const final=await cli(bin,env,['fleet','status','fleet','--json']);assert.equal(final.code,0,final.output);
  assert.equal(JSON.parse(final.output).online,false);
  const reset=await cli(bin,env,['fleet','reset','fleet','--json']);assert.equal(reset.code,0,reset.output);
  assert.equal(JSON.parse(reset.output).removed,true);
  assert.equal(readFleetCheckpoint(dir,'fleet.localhost'),null);
 }finally{if(fleet)await fleet.end();await proxy.end();fs.rmSync(dir,{recursive:true,force:true});}
});

test('a hard-killed fleet wrapper leaves a verifiable generation registry and recover cleans routes', {timeout:80000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zsrv-fleet-orphan-'));
 const [proxyPort,a,b,c]=await freePorts(4);
 const bin=new URL('../dist/bin/zerux.js',import.meta.url).pathname;
 const env={...process.env,PORTLESS_PORT:String(proxyPort),PORTLESS_STATE_DIR:dir,FAIL_DIR:dir};
 const proxy=runner([bin,'proxy','start','--port',String(proxyPort)],env);
 let fleet;
 try {
  await poll(async()=>{try{return (await request(proxyPort,'orphan.localhost')).status===404;}catch{return false;}},13000);
  fleet=runner([bin,'fleet','run','--name','orphan','--ports',`${a},${b},${c}`,'--replicas','2',
    '--health-path','/health','--health-interval','30000','--ready-timeout','2500',
    '--','node','-e',appCode],env);
  await poll(async()=>{try{return (await request(proxyPort,'orphan.localhost')).status===200;}catch{return false;}},15000);
  fleet.child.kill('SIGKILL');
  await poll(async()=>fleet.child.exitCode!==null || fleet.child.signalCode!==null,4000);
  const offline=await cli(bin,env,['fleet','status','orphan','--json']);assert.equal(offline.code,0,offline.output);
  assert.equal(JSON.parse(offline.output).recoveryRequired,true);
  const preview=await cli(bin,env,['fleet','recover','orphan','--dry-run','--json']);assert.equal(preview.code,0,preview.output);
  assert.equal(JSON.parse(preview.output).wouldTerminate.length,2);
  const recovered=await cli(bin,env,['fleet','recover','orphan','--json']);assert.equal(recovered.code,0,recovered.output);
  assert.equal(JSON.parse(recovered.output).terminated.length,2);
  await poll(async()=>{try{return (await request(proxyPort,'orphan.localhost')).status===404;}catch{return false;}});
  const after=await cli(bin,env,['fleet','status','orphan','--json']);
  assert.equal(JSON.parse(after.output).recoveryRequired,false);
 }finally{if(fleet)await fleet.end();await proxy.end();fs.rmSync(dir,{recursive:true,force:true});}
});
