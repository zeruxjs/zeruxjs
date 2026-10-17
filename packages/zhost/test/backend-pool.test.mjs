import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { BackendPool, validateBackends } from '../dist/portless/backend-pool.js';

const route = { hostname: 'pool.localhost', port: 10001, backends: [ {port:10001, weight:1}, {port:10002, weight:3} ] };
const listen = server => new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => {server.off('error',reject); resolve(server.address().port);}); });
const close = server => new Promise(resolve => server.close(resolve));

test('validates bounded local backend pool without duplicates', () => {
  assert.deepEqual(validateBackends([{port:6000}]), [{port:6000}]);
  for (const ports of [[], [{port:0}], [{port:6000},{port:6000}], [{port:6001,weight:0}], Array.from({length:33},(_,i)=>({port:10000+i}))]) {
    assert.throws(() => validateBackends(ports));
  }
  assert.deepEqual(validateBackends([{port:6001,weight:10}]), [{port:6001,weight:10}]);
});

test('smooth weighted round-robin honors weights and does not duplicate state', () => {
  const pool = new BackendPool(() => [route]);
  try {
    pool.sync([route]);
    const selections = Array.from({length:40},()=>pool.select(route).port);
    assert.equal(selections.filter(p=>p===10001).length,10);
    assert.equal(selections.filter(p=>p===10002).length,30);
    assert.equal(pool.status().length,2);
  } finally { pool.close(); }
});

test('failed endpoint is isolated and can recover after cooldown', async () => {
  const pool = new BackendPool(() => [route], {cooldownMs:100});
  try {
    pool.sync([route]);
    pool.markFailure(route.hostname,10002);
    for(let i=0;i<5;i++) assert.equal(pool.select(route).port,10001);
    assert.equal(pool.status().find(x=>x.port===10002).healthy,false);
    await new Promise(r=>setTimeout(r,115));
    assert.equal(pool.status().find(x=>x.port===10002).healthy,true);
    assert.ok(Array.from({length:8},()=>pool.select(route).port).includes(10002));
  } finally { pool.close(); }
});

test('active probes isolate an offline instance and admit it after recovery', async () => {
  const live = http.createServer((req,res)=>res.end('ok'));
  const livePort=await listen(live);
  const temp = http.createServer(); const absent=await listen(temp); await close(temp);
  const config={hostname:'probe.localhost',port:livePort,backends:[{port:livePort},{port:absent}]};
  const pool=new BackendPool(()=>[config],{failureThreshold:2,probe:{path:'/health'}});
  try {
    await pool.checkNow(); await pool.checkNow();
    assert.equal(pool.status().find(item=>item.port===absent).healthy,false);
    assert.equal(pool.select(config).port,livePort);
    // Once the instance binds the same port, a successful active probe restores it.
    const restored=http.createServer((req,res)=>res.end('ok'));
    await new Promise((resolve,reject)=>{restored.once('error',reject);restored.listen(absent,'127.0.0.1',resolve);});
    try {await pool.checkNow();assert.equal(pool.status().find(item=>item.port===absent).healthy,true);}
    finally {await close(restored);}
  } finally {pool.close();await close(live);}
});

test('removed backends and routes disappear from the pool',()=>{
  let routes=[route];
  const pool=new BackendPool(()=>routes);
  try {
    pool.sync(routes); assert.equal(pool.status().length,2);
    routes=[{hostname:'pool.localhost',port:10001}]; pool.sync(routes);
    assert.deepEqual(pool.status().map(x=>x.port),[10001]);
    pool.sync([]); assert.deepEqual(pool.status(),[]);
  } finally {pool.close();}
});
