import test from 'node:test';
import assert from 'node:assert/strict';
import { planPublicReleases } from './workspace-release-plan.mjs';
const fixture = () => new Map([
  ['core', { name:'core', pkg:{name:'core',version:'0.1.0'} }],
  ['gateway', { name:'gateway', pkg:{name:'gateway',version:'0.1.1',dependencies:{core:'0.1.0'}} }],
  ['private', { name:'private', pkg:{name:'private',version:'0.1.0',private:true} }],
]);
test('publication ordering is deterministic and dependencies are built first',()=>{
  const actual = planPublicReleases(fixture());
  assert.equal(actual.ok,true);
  assert.deepEqual(actual.order.map(p=>p.name),['core','gateway']);
  assert.equal(actual.privatePackages,1);
});
test('a mandatory private runtime dependency blocks public publication',()=>{
  const entries = fixture();entries.get('gateway').pkg.dependencies.private='0.1.0';
  assert.ok(planPublicReleases(entries).issues.some(x=>x.code==='PRIVATE_REQUIRED_DEPENDENCY'));
});
test('a private optional peer is a warning, not a mandatory npm install',()=>{
  const entries=fixture(); const pkg=entries.get('gateway').pkg;
  pkg.peerDependencies={private:'0.1.0'};pkg.peerDependenciesMeta={private:{optional:true}};
  const result=planPublicReleases(entries);
  assert.equal(result.ok,true);
  assert.equal(result.warnings[0].code,'PRIVATE_OPTIONAL_PEER');
});
test('mismatched local version is rejected without guessing a registry version',()=>{
  const entries=fixture();entries.get('gateway').pkg.dependencies.core='^9.0.0';
  assert.ok(planPublicReleases(entries).issues.some(x=>x.code==='VERSION_MISMATCH'));
});
test('dependency cycle is rejected rather than publishing arbitrary order',()=>{
  const entries=fixture();entries.get('core').pkg.dependencies={gateway:'0.1.1'};
  assert.ok(planPublicReleases(entries).issues.some(x=>x.code==='DEPENDENCY_CYCLE'));
});
