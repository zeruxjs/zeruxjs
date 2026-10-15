import test from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli=fileURLToPath(new URL('../dist/bin/zerux.js',import.meta.url));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function port(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
function launch(args,env){
  const child=spawn(process.execPath,[cli,...args],{env,stdio:['ignore','pipe','pipe']});
  let out='';for(const s of [child.stdout,child.stderr])s.on('data',chunk=>out+=chunk);
  const completed=new Promise(r=>child.once('close',(code,signal)=>r({code,signal})));
  return {child,completed,output:()=>out};
}
async function waitUntil(check,ms=7000){const end=Date.now()+ms;while(Date.now()<end){try{if(await check())return;}catch{}await sleep(35);}throw Error('Timed out waiting for state');}
async function get(portNumber,host){return new Promise((res,rej)=>{const req=http.get({host:'127.0.0.1',port:portNumber,headers:{Host:host},timeout:500},response=>{let body='';response.on('data',x=>body+=x);response.on('end',()=>res({status:response.statusCode,body}));});req.on('error',rej);req.on('timeout',()=>req.destroy());});}
async function status(env){const cliProcess=launch(['status','demo','--json'],env);const done=await cliProcess.completed;assert.equal(done.code,0,cliProcess.output());return JSON.parse(cliProcess.output());}

test('CLI status reads live process and SIGUSR2 reload transitions to the next generation', {timeout:18000},async()=>{
  if(process.platform==='win32')return;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zsrv-reload-int-'));
  const proxyPort=await port(),appPort=await port();
  const countFile=path.join(dir,'counter');
  const env={...process.env,PORTLESS_STATE_DIR:dir,PORTLESS_PORT:String(proxyPort)};
  const proxy=launch(['proxy','start','--port',String(proxyPort)],env);
  let app;
  try {
    await waitUntil(async()=>{try{return (await get(proxyPort,'none.localhost')).status>0;}catch{return false;}},6500);
    const code=`const fs=require('node:fs');let n=0;try{n=Number(fs.readFileSync(${JSON.stringify(countFile)},'utf8'))}catch{};n++;fs.writeFileSync(${JSON.stringify(countFile)},String(n));const server=require('node:http').createServer((req,res)=>res.end('instance-'+n));server.listen(Number(process.env.PORT),'127.0.0.1');process.on('SIGTERM',()=>server.close());`;
    app=launch(['run','--name','demo','--app-port',String(appPort),'--ready-timeout','3000','--reload-signal','--restart','never','--',process.execPath,'-e',code],env);
    await waitUntil(async()=>{const rows=await status(env);return rows.length===1&&rows[0].alive&&rows[0].status.phase==='running'&&rows[0].status.generation===1;});
    assert.equal((await get(proxyPort,'demo.localhost')).body,'instance-1');
    app.child.kill('SIGUSR2');
    await waitUntil(async()=>{const rows=await status(env);return rows.some(x=>x.alive&&x.status.generation===2&&x.status.phase==='running');},8000);
    assert.equal((await get(proxyPort,'demo.localhost')).body,'instance-2');
    assert.equal(fs.readFileSync(countFile,'utf8'),'2');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'routes.json'),'utf8')).filter(x=>x.hostname==='demo.localhost').length,1);
    app.child.kill('SIGTERM');
    assert.equal((await app.completed).code,0,app.output());
    await waitUntil(async()=>{const rows=await status(env);return rows.length===1&&rows[0].status.phase==='stopped'&&!rows[0].alive;});
  } finally {
    if(app?.child.exitCode===null){app.child.kill('SIGKILL');await app.completed;}
    proxy.child.kill('SIGTERM');
    await Promise.race([proxy.completed,sleep(2000)]);
    if(proxy.child.exitCode===null)proxy.child.kill('SIGKILL');
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
