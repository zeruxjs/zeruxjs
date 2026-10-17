import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import { spawn } from 'node:child_process';
export const bin=new URL('../../dist/bin/zerux.js',import.meta.url).pathname;
export const appCode=String.raw`
const http=require('node:http');const port=+process.env.PORT;
const server=http.createServer((req,res)=>{if(req.url==='/health'){res.end('ok');return;}res.end('backend:'+port)});
server.listen(port,'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
export const runner=(args,env)=>{
 const child=spawn(process.execPath,[bin,...args],{env,stdio:['ignore','pipe','pipe']});
 let logs='';for(const s of [child.stdout,child.stderr])s.on('data',b=>logs+=b.toString());
 return {child,get logs(){return logs},async end(){if(child.exitCode!==null||child.signalCode!==null)return;child.kill('SIGTERM');let timer;await Promise.race([new Promise(r=>child.once('exit',r)),new Promise(r=>{timer=setTimeout(r,2500);})]);clearTimeout(timer);if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}};
};
export async function cli(args,env,timeout=25000){
 const p=runner(args,env);
 let timer;
 try {await Promise.race([new Promise((resolve,reject)=>p.child.once('exit',code=>code===0?resolve():reject(new Error(`exit ${code}: ${p.logs}`)))),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`CLI timeout: ${args.join(' ')}`)),timeout);})]);
  return p.logs.trim();
 } finally {clearTimeout(timer);await p.end();}
}
export async function poll(fn,timeout=15000){let err;const until=Date.now()+timeout;while(Date.now()<until){try{const value=await fn();if(value)return value;}catch(e){err=e;}await wait(70);}throw new Error('timeout: '+(err?.message||'not ready'));}
export const request=(port,hostname)=>new Promise((resolve,reject)=>{
 const req=http.get({host:'127.0.0.1',port,headers:{Host:hostname,Connection:'close'}},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>resolve({status:res.statusCode,body}));});req.once('error',reject);
});
async function freePorts(n){const servers=Array.from({length:n},()=>net.createServer());try{await Promise.all(servers.map(s=>new Promise(r=>s.listen(0,'127.0.0.1',r))));return servers.map(s=>s.address().port);}finally{await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));}}
export async function cliFixture(testFn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fleet-scale-cli-'));const [proxyPort,...ports]=await freePorts(6);
 const env={...process.env,PORTLESS_STATE_DIR:dir,PORTLESS_PORT:String(proxyPort)};
 const proxy=runner(['proxy','start','--port',String(proxyPort)],env);
 let fleet;
 try {
  await poll(async()=>{try{return (await request(proxyPort,'scale.localhost')).status===404;}catch{return false;}});
  const start=async(extra=[])=>{
   fleet=runner(['fleet','run','--name','scale','--ports',ports.join(','),'--replicas','2','--health-path','/health',
    '--health-interval','30000','--ready-timeout','2000','--shutdown-timeout','1000',...extra,'--',process.execPath,'-e',appCode],env);
   await poll(async()=>{try{return (await request(proxyPort,'scale.localhost')).status===200;}catch{return false;}});
   return fleet;
  };
  return await testFn({dir,env,proxyPort,ports,start,get fleet(){return fleet;}});
 } finally {if(fleet)await fleet.end();await proxy.end();fs.rmSync(dir,{recursive:true,force:true});}
}
