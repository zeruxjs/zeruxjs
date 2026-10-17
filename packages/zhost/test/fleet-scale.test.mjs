import test from 'node:test';
import assert from 'node:assert/strict';
import { fleetFixture } from './helpers/fleet-fixture.mjs';

test('scale up and down switches route atomically, retains a spare and drains old work', async()=> fleetFixture(async({fleet,store,proxy,ports})=>{
  assert.equal(fleet.status.desiredReplicas,2);
  const snapshot=await fleet.scaleTo(3);
  assert.equal(snapshot.desiredReplicas,3);
  assert.equal(fleet.status.members.filter(m=>m.routed).length,3);
  assert.deepEqual(store.loadRoutes()[0].backends.map(b=>b.port),ports.slice(0,3));
  const finished=proxy.backendConnections.track('scale.localhost',ports[2]);
  const downsizing=fleet.scaleTo(2);
  await new Promise(r=>setTimeout(r,40));
  assert.deepEqual(store.loadRoutes()[0].backends.map(b=>b.port),ports.slice(0,2));
  finished();
  await downsizing;
  assert.equal(fleet.status.members.filter(m=>m.routed).length,2);
  assert.equal(fleet.status.phase,'running');
}));

test('out-of-range scale attempts do not change routes or desired count',async()=>fleetFixture(async({fleet,store})=>{
  const before=store.loadRoutes();
  for(const count of [0,1,5,16,1.5,NaN]) await assert.rejects(fleet.scaleTo(count),/Scale target/);
  assert.deepEqual(store.loadRoutes(),before);
  assert.equal(fleet.status.desiredReplicas,2);
}));

test('resizing is serialized with concurrent reconciles and subsequent scale requests',async()=>fleetFixture(async({fleet,store})=>{
  const [a,b]=await Promise.all([fleet.scaleTo(3),fleet.scaleTo(2)]);
  assert.equal(a.desiredReplicas,3);
  assert.equal(b.desiredReplicas,2);
  assert.equal(store.loadRoutes()[0].backends.length,2);
  const check=await fleet.reconcile();
  assert.equal(check.status.desiredReplicas,2);
}));

test('stopping after scale rejects new mutations without leaving an owner route',async()=>fleetFixture(async({fleet,store})=>{
  await fleet.scaleTo(3);
  await fleet.stop();
  await assert.rejects(fleet.scaleTo(2),/stopping/);
  assert.deepEqual(store.loadRoutes(),[]);
}));

test('a superseded route prevents a resize from changing the newer owner',async()=>fleetFixture(async({fleet,store,ports})=>{
  const newer=store.registerRoute('scale.localhost',ports[4],process.pid,true);
  await assert.rejects(fleet.scaleTo(3),/superseded/);
  assert.equal(store.loadRoutes()[0].leaseId,newer.leaseId);
  assert.equal(store.loadRoutes()[0].port,ports[4]);
}));


test('partial scale-up retains serving capacity and a later reconcile repairs the deficit',async()=>fleetFixture(async({fleet,store,ports,dir})=>{
  const fs=(await import('node:fs')).default;
  const blocker=`${dir}/block-${ports[3]}`;
  fs.writeFileSync(blocker,'block');
  try {
    await assert.rejects(fleet.scaleTo(4),/before|exited|startup|process|ready/i);
    assert.equal(fleet.status.desiredReplicas,4);
    assert.equal(fleet.status.phase,'degraded');
    assert.equal(store.loadRoutes()[0].backends.length,3);
  } finally {fs.unlinkSync(blocker);}
  const result=await fleet.reconcile();
  assert.equal(result.failures.length,0);
  assert.equal(fleet.status.phase,'running');
  assert.equal(store.loadRoutes()[0].backends.length,4);
}));

test('zero replacement budget still permits an explicit safe operator scale',async()=>fleetFixture(async({fleet,store})=>{
  // The operator can provision new capacity even when automated replacement is disabled.
  await fleet.scaleTo(3);
  assert.equal(store.loadRoutes()[0].backends.length,3);
},{maxReplacements:0}));
