import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fork} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {startServer} from '../dist/index.js';

test('direct HTTP startup leaves unverifiable shared proxy state untouched', {timeout:15000},async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'zhost-direct-'));
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');
 const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
 let child;
 try {
  await symlink(path.resolve('../../node_modules'),path.join(root,'node_modules'),'dir');
  const state=path.join(root,'proxy-state');await mkdir(state,{mode:0o700});
  await writeFile(path.join(state,'proxy.pid'),'unverifiable fixture owner');
  const runner=path.join(root,'runner.mjs');
  await writeFile(runner,`import {startServer} from 'zhost';
    await startServer({service:'fixture',config:{server:{portless:false}},app:{name:'direct',port:Number(process.argv[2]),func(_req,res){res.end('direct response');}}});
    process.send({ready:true});`);
  child=fork(runner,[String(port)],{cwd:root,env:{...process.env,PORTLESS_STATE_DIR:state},stdio:['ignore','pipe','pipe','ipc']});
  let output='';child.stdout.on('data',part=>output+=part);child.stderr.on('data',part=>output+=part);
  await new Promise((resolve,reject)=>{child.once('message',resolve);child.once('error',reject);child.once('exit',code=>reject(Error('Startup exited '+code+': '+output)));});
  assert.equal(await(await fetch(`http://127.0.0.1:${port}`)).text(),'direct response');
  assert.equal(await readFile(path.join(state,'proxy.pid'),'utf8'),'unverifiable fixture owner');
  assert.doesNotMatch(output,/Starting portless|Portless proxy ready/);
 } finally {
  if(child&&child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
  await rm(root,{recursive:true,force:true});
 }
});
test('invalid portless options reject before listeners or proxy resources are acquired',async()=>{
 await assert.rejects(startServer({config:{server:{portless:'false'}},app:{func(){}}}),/Invalid server.portless/);
});
