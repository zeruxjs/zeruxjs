import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BackendPool } from '../dist/portless/backend-pool.js';
import { BackendConnections } from '../dist/portless/backend-connections.js';
import { createProxyConnectionControl, RemoteBackendConnections } from '../dist/portless/proxy-control.js';

const lease='a0000000-0000-4000-8000-000000000001';
test('authenticated backend-status control reports fresh per-route health and isolates failures',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zsrv-backend-control-'));
 const route={hostname:'rpc.localhost',port:4300,pid:99,leaseId:lease,backends:[{port:4300},{port:4301,weight:3}]};
 const pool=new BackendPool(()=>[route]);
 const control=await createProxyConnectionControl(dir,new BackendConnections(),pool);
 try {
  const remote=new RemoteBackendConnections(dir);
  assert.deepEqual((await remote.status('rpc.localhost')).map(x=>x.port),[4300,4301]);
  pool.markFailure('rpc.localhost',4301);
  assert.deepEqual((await remote.status('rpc.localhost')).map(x=>x.healthy),[true,false]);
  await assert.rejects(remote.status('../bad'),/Invalid backend hostname/);
  assert.deepEqual(await remote.status('other.localhost'),[]);
 } finally {await control.close();pool.close();fs.rmSync(dir,{force:true,recursive:true});}
});
