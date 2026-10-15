import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createLocalControl, sendLocalControl, readControlDescriptor } from '../dist/portless/local-control.js';
import { createDeploymentHistory, readDeploymentHistory } from '../dist/portless/deployment-history.js';
import { parseRollingRunArguments } from '../dist/bin/parse-rolling.js';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
 const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;
 await new Promise(r=>s.close(r));return port;
}
const appCode = `const http=require('node:http');const port=+process.env.PORT;
const server=http.createServer((req,res)=>{if(req.url==='/health'){res.end('ok');return;}
if(req.url==='/slow'){setTimeout(()=>res.end(String(port)),700);return;}
res.end(String(port));});server.listen(port,'127.0.0.1');
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));`;
const get = (port, host, route = '/') => new Promise((resolve,reject)=> {
 const req=http.get({host:'127.0.0.1',port,path:route,headers:{Host:host,Connection:'close'}},res=>{
 let raw='';res.on('data',c=>raw+=c);res.on('end',()=>resolve({status:res.statusCode,body:raw}));});req.on('error',reject);
});
function runner(argv, env) {
 const child=spawn(process.execPath, argv, {env,stdio:['ignore','pipe','pipe']});
 let logs='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{logs+=chunk.toString();});
 return {child,get logs(){return logs},async end() {
   if (child.exitCode===null) child.kill('SIGTERM');
   let timer;await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>{timer=setTimeout(r,1500);})]);clearTimeout(timer);
   if (child.exitCode===null) child.kill('SIGKILL');
 }};
}
async function cli(bin, env, args) {
 const s=runner([bin,...args],env);
 let timer; const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve('timeout'),20000);});
 const code=await Promise.race([new Promise(resolve=>s.child.once('exit', resolve)),timeout]);
 clearTimeout(timer);
 if(code==='timeout'){await s.end(); throw new Error(`CLI timeout: ${args.join(' ')} ${s.logs}`);}
 return {code,output:s.logs};
}
async function poll(fn, time=7000) {
 const until=Date.now()+time;let error;
 while(Date.now()<until) {try{const result=await fn();if(result)return result;}catch(e){error=e;}await delay(55);}
 throw new Error(`Timed out polling: ${error?.message??'not ready'}`);
}

test('rolling options preserve application flags and reject unsafe or duplicate values',()=>{
 const args=parseRollingRunArguments(['--name','api','--ports','4300,4301','--health-path','/health','--','node','app.js','--force']);
 assert.deepEqual(args.command,['node','app.js','--force']);assert.deepEqual(args.ports,[4300,4301]);
 assert.throws(()=>parseRollingRunArguments(['--name','api','--ports','4300,4300','--','node','app']),/distinct/);
 assert.throws(()=>parseRollingRunArguments(['--name','api','--ports','4300,4301','--health-path','//evil','--','node']),/health/);
});

test('local control authenticates requests, protects private descriptors and closes correctly',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zsrv-rpc-'));
 try {
  const service=await createLocalControl(dir,'example.localhost',(action,data)=>{if(action==='echo')return data;throw Error('Unknown');});
  assert.deepEqual(await sendLocalControl(dir,'example.localhost','echo',{answer:42}),{answer:42});
  const meta=readControlDescriptor(dir,'example.localhost');assert.equal(meta.port,service.descriptor.port);
  await assert.rejects(sendLocalControl(dir,'example.localhost','invalid'),/Unknown/);
  assert.equal(fs.statSync(path.dirname(path.join(dir,'app-controls-'+(process.getuid?.()??'user')))).isDirectory(),true);
  assert.equal(fs.statSync(path.join(dir,`app-controls-${process.getuid?.()??'user'}`)).mode & 0o077,0);
  const unauthorized=await new Promise(resolve=>{
   const socket=net.connect({host:'127.0.0.1',port:meta.port});let raw='';
   socket.on('connect',()=>socket.write(JSON.stringify({action:'echo',token:'0'.repeat(64),data:'secret'})+'\n'));
   socket.on('data',chunk=>raw+=chunk);socket.on('end',()=>resolve(raw));socket.on('error',()=>resolve(raw));
  });
  assert.match(unauthorized,/Unauthorized/);
  await service.close();assert.equal(readControlDescriptor(dir,'example.localhost'),null);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('deployment history bounds events, retains generations, refuses symlink replacement',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zsrv-deploy-hist-'));
 try {
  const initial={phase:'running',generation:1,port:4000,pid:process.pid,previousPort:null,updatedAt:new Date().toISOString()};
  const journal=createDeploymentHistory(dir,'history.localhost',initial);
  for(let i=0;i<60;i++)journal.record('deployed',{fromPort:4000,toPort:4001,generation:2});
  journal.update({...initial,generation:2,port:4001});
  assert.equal(readDeploymentHistory(dir,'history.localhost').history.length,50);
  assert.equal(readDeploymentHistory(dir,'history.localhost').status.port,4001);
  const directory=fs.readdirSync(dir).find(f=>f.startsWith('app-controls'));
  const file=fs.readdirSync(path.join(dir,directory)).find(f=>f.endsWith('.history.json'));
  const target=path.join(dir,directory,file);
  fs.unlinkSync(target);fs.symlinkSync('/etc/passwd',target);
  assert.throws(()=>readDeploymentHistory(dir,'history.localhost'),/Unsafe/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('separate proxy and rolling wrapper coordinate deploy, drain in-flight traffic, history and shutdown', {timeout:60000}, async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zsrv-cli-rolling-'));
 const p=await freePort(),a=await freePort(),b=await freePort();
 const bin=new URL('../dist/bin/zerux.js',import.meta.url).pathname;
 const env={...process.env, PORTLESS_PORT:String(p),PORTLESS_STATE_DIR:dir};
 const proxy=runner([bin,'proxy','start','--port',String(p)],env);
 let wrapper;
 try {
  await poll(async()=>{try{const r=await get(p,'hello.localhost');return r.status===404;}catch{return false;}});
  wrapper=runner([bin,'rolling','run','--name','hello','--ports',`${a},${b}`,'--health-path','/health','--drain-timeout','2500','--','node','-e',appCode],env);
  await poll(async()=>{try{const r=await get(p,'hello.localhost');return r.body===String(a);}catch{return false;}});
  const held=get(p,'hello.localhost','/slow');
  await delay(75);
  const deployment=await cli(bin,env,['rolling','deploy','hello']);
  assert.equal(deployment.code,0,deployment.output+' '+wrapper.logs);
  const first=await held;
  assert.equal(first.body,String(a));
  const newer=await get(p,'hello.localhost');assert.equal(newer.body,String(b));
  const status=await cli(bin,env,['rolling','status','hello','--json']);assert.equal(status.code,0,status.output);
  const parsed=JSON.parse(status.output);assert.equal(parsed.status.generation,2);assert.equal(parsed.online,true);
  const history=await cli(bin,env,['rolling','history','hello','--json']);assert.equal(history.code,0,history.output);
  assert.equal(JSON.parse(history.output).at(-1).outcome,'deployed');
  assert.equal(JSON.parse(history.output).at(-1).drained,true);
  const stopped=await cli(bin,env,['rolling','stop','hello']);assert.equal(stopped.code,0,stopped.output+' '+wrapper.logs);
  await poll(async()=>{const r=await get(p,'hello.localhost');return r.status===404;});
  const after=await cli(bin,env,['rolling','status','hello','--json']);
  assert.equal(JSON.parse(after.output).online,false);
 }finally{
  if(wrapper)await wrapper.end();
  await proxy.end();
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
