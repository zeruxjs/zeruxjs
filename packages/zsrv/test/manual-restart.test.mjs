import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';
import { launchManagedApplication } from '../dist/portless/managed-app.js';

const childCode = `const http=require('node:http');
const fs=require('node:fs');
let n=0;try{n=Number(fs.readFileSync(process.env.COUNT_FILE,'utf8'))}catch{};
fs.writeFileSync(process.env.COUNT_FILE,String(++n));
const server=http.createServer((req,res)=>res.end('ready'));
server.listen(Number(process.env.PORT),'127.0.0.1');
process.on('SIGTERM',()=>server.close());`;
async function freePort() {
  const server=net.createServer();
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('manual restart coalesces callers, preserves ready-only leases and exposes snapshots', {timeout:14000}, async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zsrv-manual-'));
  const file=path.join(dir,'count');
  const statuses=[];let acquired=0,released=0;
  let app;
  try {
    const port=await freePort();
    app=await launchManagedApplication([process.execPath,'-e',childCode],{
      port,env:{COUNT_FILE:file,PORT:String(port)},stdio:'ignore',restartPolicy:'never',shutdownTimeoutMs:1000,
      onReady:()=>{acquired++;return ()=>released++;},onStatus:status=>statuses.push(status)
    });
    assert.equal(app.status.phase,'running');
    assert.equal(app.status.generation,1);
    const observed=[];
    const unsubscribe=app.subscribe(status=>observed.push(status.phase));
    const p1=app.restart(),p2=app.restart();
    assert.equal(p1,p2);
    await Promise.all([p1,p2]);
    assert.equal(app.status.phase,'running');
    assert.equal(app.status.generation,2);
    assert.equal(app.status.automaticRestarts,0);
    assert.equal(acquired,2);
    assert.equal(released,1);
    assert.equal(fs.readFileSync(file,'utf8'),'2');
    assert.equal(statuses.some(x=>x.phase==='restarting'),true);
    assert.equal(observed.includes('running'),true);
    unsubscribe();
    const count=observed.length;
    await app.stop();
    assert.equal(app.status.phase,'stopped');
    assert.equal(app.status.pid,null);
    assert.equal(app.running,false);
    assert.equal(released,2);
    assert.equal(observed.length,count);
    await assert.rejects(app.restart(),/stopped/);
    assert.equal(statuses.at(-1).phase,'stopped');
  } finally { if(app?.running)await app.stop();fs.rmSync(dir,{recursive:true,force:true}); }
});

test('manual restart is cancelled by shutdown without spawning another child', {timeout:12000},async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zsrv-manual-cancel-'));
  const file=path.join(dir,'count');let app;
  try {
    const port=await freePort();
    app=await launchManagedApplication([process.execPath,'-e',childCode],{
      port,env:{COUNT_FILE:file,PORT:String(port)},stdio:'ignore',restartPolicy:'always',shutdownTimeoutMs:1000
    });
    const restart=app.restart();
    const stop=app.stop();
    await assert.rejects(restart,/cancelled/);
    await stop;
    await sleep(100);
    assert.equal(fs.readFileSync(file,'utf8'),'1');
    assert.equal(app.running,false);
  } finally {if(app?.running)await app.stop();fs.rmSync(dir,{recursive:true,force:true});}
});
