import test from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../dist/bin/zerux.js', import.meta.url));
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: timed out`)), ms);
  })]).finally(() => clearTimeout(timer));
}

async function freePort() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function launch(args, env) {
  const child = spawn(process.execPath, [cli, ...args], {
    env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output += chunk.toString(); });
  const ended = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  return { child, ended, output: () => output };
}

async function until(check, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await pause(40);
  }
  throw new Error('Condition not met before timeout');
}

function request(port, host) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, headers: { Host: host }, timeout: 800 }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk.toString(); });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

test('CLI publishes routes only after readiness, proxies traffic, and releases lease on exit', { timeout: 15000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zsrv-supervision-int-'));
  const proxyPort = await freePort();
  const appPort = await freePort();
  const env = { ...process.env, PORTLESS_STATE_DIR: dir, PORTLESS_PORT: String(proxyPort) };
  const proxy = launch(['proxy', 'start', '--port', String(proxyPort)], env);
  let app;
  try {
    await until(async () => {
      try { return (await request(proxyPort, 'none.localhost')).status > 0; } catch { return false; }
    });
    const script = `setTimeout(() => {
      const server = require('node:http').createServer((req,res) => res.end('supervision-ok'));
      server.listen(Number(process.env.PORT), '127.0.0.1');
      process.on('SIGTERM', () => server.close());
    }, 600);`;
    app = launch(['run', '--name', 'demo', '--app-port', String(appPort), '--ready-timeout', '3000', '--', process.execPath, '-e', script], env);
    await pause(160);
    const routesFile = path.join(dir, 'routes.json');
    if (fs.existsSync(routesFile)) {
      assert.equal(JSON.parse(fs.readFileSync(routesFile, 'utf8')).some(r => r.hostname === 'demo.localhost'), false,
        'a not-yet-ready child must never be published');
    }
    await until(() => fs.existsSync(routesFile) && JSON.parse(fs.readFileSync(routesFile, 'utf8')).some(r => r.hostname === 'demo.localhost'));
    const response = await request(proxyPort, 'demo.localhost');
    assert.equal(response.status, 200, app.output());
    assert.equal(response.body, 'supervision-ok');
    app.child.kill('SIGTERM');
    await withTimeout(app.ended, 3500, 'child wrapper');
    await until(() => JSON.parse(fs.readFileSync(routesFile, 'utf8')).every(r => r.hostname !== 'demo.localhost'));
  } finally {
    if (app?.child.exitCode === null) app.child.kill('SIGKILL');
    proxy.child.kill('SIGTERM');
    await withTimeout(proxy.ended, 2500, 'proxy wrapper');
    if (proxy.child.exitCode === null) proxy.child.kill('SIGKILL');
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI restarts crashed app with HTTP readiness and republishes lease only when healthy', { timeout: 16000 }, async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zsrv-restart-int-'));
  const proxyPort=await freePort(), appPort=await freePort();
  const counter=path.join(dir,'launches.txt');
  const env={...process.env,PORTLESS_STATE_DIR:dir,PORTLESS_PORT:String(proxyPort)};
  const proxy=launch(['proxy','start','--port',String(proxyPort)],env);
  let wrapper;
  try {
    await until(async()=>{try{return (await request(proxyPort,'none.localhost')).status>0;}catch{return false;}},6000);
    const script=`const fs=require('node:fs');const f=${JSON.stringify(counter)};
      let count=0;try{count=Number(fs.readFileSync(f,'utf8'))}catch{};
      count++;fs.writeFileSync(f,String(count));
      const server=require('node:http').createServer((req,res)=>{
        if(req.url==='/health'){res.end('ready');return;}
        res.end('launch-'+count);
      });
      server.listen(Number(process.env.PORT),'127.0.0.1',()=>{
        if(count===1)setTimeout(()=>process.exit(7),400);
      });
      process.on('SIGTERM',()=>server.close());`;
    wrapper=launch(['run','--name','recover','--app-port',String(appPort),
      '--ready-timeout','3000','--health-path','/health',
      '--restart','on-failure','--max-restarts','2','--restart-delay','100',
      '--','node','-e',script],env);
    await until(async()=>{
      try{return (await request(proxyPort,'recover.localhost')).body==='launch-2';}catch{return false;}
    },8000);
    const routes=JSON.parse(fs.readFileSync(path.join(dir,'routes.json'),'utf8'));
    assert.equal(routes.filter(route=>route.hostname==='recover.localhost').length,1);
    assert.equal(fs.readFileSync(counter,'utf8'),'2');
    wrapper.child.kill('SIGTERM');
    await withTimeout(wrapper.ended,4000,'restart wrapper');
    await until(()=>JSON.parse(fs.readFileSync(path.join(dir,'routes.json'),'utf8')).every(r=>r.hostname!=='recover.localhost'));
  } finally {
    if(wrapper?.child.exitCode===null)wrapper.child.kill('SIGKILL');
    proxy.child.kill('SIGTERM');
    await withTimeout(proxy.ended,2500,'proxy wrapper');
    if(proxy.child.exitCode===null)proxy.child.kill('SIGKILL');
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
