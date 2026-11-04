import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createAssetManager,validateAsset,AssetRevisionError} from '../dist/index.js';
import {createBrandCatalog,migrateBrandSnapshot,validateBrandUsage,hashAssetMetadata,saveBrandSnapshot,loadBrandSnapshot,BrandAuditError,BrandRevisionError} from '../dist/brand.js';
const actor={tenant:'tenant-a',actor:'editor'};
const asset={id:'brand/logo',name:'Logo',type:'image',url:'https://cdn.example/logo?signature=PRIVATE_URL',variants:{dark:{url:'https://cdn.example/dark'},french:{url:'https://cdn.example/fr'}},brand:{colorTokens:{accent:'#AABBCC'},logoVariants:{primary:'dark'},localeVariants:{'fr-fr':'french'},themeVariants:{dark:'dark'},safeArea:{unit:'ratio',top:0.1,right:0.1,bottom:0.1,left:0.1},minimumSize:{unit:'px',width:100,height:50},publication:'draft',developerNotes:'<script>PRIVATE_NOTE()</script>'}};
function fixture(extra={}){const catalog=createAssetManager(),events=[];const options={catalog,tenant:actor.tenant,authorize:()=>true,auditPolicy:'required',audit:{append:async event=>events.push(event)},now:()=>1000,...extra};return {catalog,events,options,brand:createBrandCatalog(options)};}
test('brand rules validate exact colors, references, dimensions, publication and inert notes',()=>{
 const validated=validateAsset(asset);assert.equal(validated.brand.colorTokens.accent,'#aabbcc');assert.equal(validated.brand.localeVariants['fr-FR'],'french');assert.equal(validated.brand.developerNotes,asset.brand.developerNotes);
 assert.deepEqual(validateBrandUsage(validated,{width:100,height:50,clearance:{top:5,right:5,bottom:5,left:5}}),[]);
 assert.ok(validateBrandUsage(validated,{width:90,height:40,clearance:{top:0,right:0,bottom:0,left:0}}).some(i=>i.code==='MINIMUM_SIZE'));
 for(const brand of [{colorTokens:{accent:'red; color: transparent'}},{logoVariants:{primary:'missing'}},{localeVariants:{'bad_locale':'dark'}},{localeVariants:{'en-us':'dark','en-US':'dark'}},{themeVariants:{bogus:'dark'}},{minimumSize:{unit:'px',width:NaN,height:1}},{safeArea:{unit:'em',top:1,right:1,bottom:1,left:1}},{publication:'approved'},{developerNotes:'a'.repeat(8193)},{unknown:true}])assert.throws(()=>validateAsset({...asset,brand}));
 let evaluated=false;const brand={};Object.defineProperty(brand,'developerNotes',{enumerable:true,get(){evaluated=true;return 'bad';}});assert.throws(()=>validateAsset({...asset,brand}));assert.equal(evaluated,false);
});
test('V1 migration preserves storage records, revision and notes without inventing historical actors',()=>{
 const catalog=createAssetManager();catalog.add(asset);catalog.add({id:'storage.version/private',name:'storage history',type:'other',metadata:{reference:'unchanged'}});
 const original=catalog.snapshot(),migrated=migrateBrandSnapshot(original,actor.tenant,77);
 assert.equal(migrated.version,2);assert.equal(migrated.catalog.revision,original.revision);assert.equal(migrated.history.length,1);assert.equal(migrated.history[0].action,'migration');assert.equal(migrated.history[0].actor,undefined);assert.equal(migrated.history[0].at,77);
 assert.deepEqual(migrated.catalog.assets[1],original.assets[1]);assert.equal(original.version,1);
 assert.deepEqual(migrateBrandSnapshot(migrated,actor.tenant),migrated);
 assert.throws(()=>migrateBrandSnapshot(migrated,'other'));
 const corrupted=structuredClone(migrated);corrupted.history[0].asset.brand.developerNotes='changed';assert.throws(()=>migrateBrandSnapshot(corrupted,actor.tenant),/hash/);
 const bad=structuredClone(migrated);bad.history[0].previousVersionId=bad.history[0].versionId;assert.throws(()=>migrateBrandSnapshot(bad,actor.tenant),/parent/);
});
test('add/update/delete/restore append immutable history with UI-resolvable revision conflicts and redacted audit events',async()=>{
 const {catalog,events,brand}=fixture();
 try{
  const added=await brand.add(actor,asset,0),before=await brand.snapshot(actor);
  await assert.rejects(brand.update(actor,asset.id,{name:'stale'},0),error=>error instanceof AssetRevisionError&&error instanceof BrandRevisionError&&error.expectedRevision===0&&error.actualRevision===1);
  assert.equal(events.length,2);
  const updated=await brand.update(actor,asset.id,{brand:{...asset.brand,publication:'published'}},1);
  assert.notEqual(updated.version.versionId,added.version.versionId);assert.equal(updated.version.previousVersionId,added.version.versionId);
  await brand.delete(actor,asset.id,2);assert.equal(catalog.get(asset.id),undefined);
  await brand.restore(actor,added.version.versionId,3);assert.equal(catalog.get(asset.id).brand.publication,'draft');
  const history=await brand.history(actor,asset.id);assert.equal(history.length,4);assert.deepEqual(before.history[0],history[0]);history[0].asset.name='mutated';assert.equal((await brand.history(actor,asset.id))[0].asset.name,'Logo');
  assert.deepEqual(events.filter(e=>e.phase==='committed').map(e=>e.action),['add','update','delete','restore']);
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE_URL|PRIVATE_NOTE|https:|developerNotes/);assert.ok(events.every(e=>e.tenant===actor.tenant&&e.actor===actor.actor&&e.hashDomain==='asset-metadata-v1'));
  assert.equal(events[0].afterHash,hashAssetMetadata(asset));
  await assert.rejects(brand.update(actor,'storage.version/private',{name:'unsafe'},4));
 }finally{await brand.close();}
});
test('required audit intent failure denies mutation and preserves private causes',async()=>{
 const {catalog,brand}=fixture({audit:{append:async()=>{throw new Error('PRIVATE_SINK_DETAIL');}}});
 try{await assert.rejects(brand.add(actor,asset,0),error=>error instanceof BrandAuditError&&error.phase==='intent'&&!error.committed&&error.cause.message==='PRIVATE_SINK_DETAIL'&&!error.message.includes('PRIVATE'));assert.equal(catalog.size,0);assert.equal((await brand.history(actor,asset.id)).length,0);}finally{await brand.close();}
});
test('required postcommit failure returns a committed receipt; retries cannot silently replay the edit',async()=>{
 const {catalog,brand}=fixture({audit:{append:async event=>{if(event.phase==='committed')throw new Error('exporter unavailable');}}});let receipt;
 try{await assert.rejects(brand.add(actor,asset,0),error=>{assert.equal(error.committed,true);receipt=error.receipt;return error instanceof BrandAuditError;});assert.equal(catalog.revision,1);assert.ok(receipt.versionId);assert.equal((await brand.history(actor,asset.id))[0].versionId,receipt.versionId);await assert.rejects(brand.add(actor,asset,0),BrandRevisionError);}finally{await brand.close();}
});
test('best-effort audit failures are explicit result status, tenant/authorization denials emit nothing',async()=>{
 const {catalog,brand}=fixture({auditPolicy:'best-effort',audit:{append:async()=>{throw new Error('offline');}},authorize:who=>who.actor==='editor'});
 try{await assert.rejects(brand.add({...actor,tenant:'other'},asset,0),/tenant denied/);await assert.rejects(brand.add({...actor,actor:'denied'},asset,0),/action denied/);assert.equal(catalog.size,0);const result=await brand.add(actor,asset,0);assert.equal(result.audit,'failed');assert.equal(catalog.revision,1);}finally{await brand.close();}
});
test('external revision change after intent emits rejected phase and does not overwrite current state',async()=>{
 const catalog=createAssetManager(),events=[];const {brand}=fixture({catalog,audit:{append:async event=>{events.push(event);if(event.phase==='intent')catalog.add({id:'other',name:'Concurrent',type:'other'});}}});
 try{await assert.rejects(brand.add(actor,asset,0),error=>error instanceof BrandRevisionError&&error.auditStatus==='written');assert.equal(catalog.get(asset.id),undefined);assert.equal(catalog.get('other').name,'Concurrent');assert.deepEqual(events.map(e=>e.phase),['intent','rejected']);}finally{await brand.close();}
});
test('V2 private persistence/restoration preserves immutable versions; symlink output is rejected',async()=>{
 const root=await mkdtemp(join(tmpdir(),'zx-brand-'));const {brand}=fixture();
 try{const added=await brand.add(actor,asset,0),snapshot=await brand.snapshot(actor),file=join(root,'brand.json');await saveBrandSnapshot(snapshot,file);const loaded=await loadBrandSnapshot(file,actor.tenant);assert.deepEqual(loaded,snapshot);
  const catalog=createAssetManager(),restored=createBrandCatalog({catalog,tenant:actor.tenant,snapshot:loaded,authorize:()=>true,audit:{append:async()=>{}},auditPolicy:'required'});
  try{await restored.delete(actor,asset.id,1);await restored.restore(actor,added.version.versionId,2);assert.equal((await restored.history(actor,asset.id)).length,3);}finally{await restored.close();}
  await symlink(file,join(root,'alias.json'));await assert.rejects(saveBrandSnapshot(snapshot,join(root,'alias.json')));
 }finally{await brand.close();await rm(root,{recursive:true,force:true});}
});
test('close drains actual audit settlement and releases the catalog lease exactly once',async()=>{
 let release,started;const ready=new Promise(r=>started=r),wait=new Promise(r=>release=r);
 const {catalog,options,brand}=fixture({audit:{append:async event=>{if(event.phase==='intent'){started();await wait;}}}});
 const work=brand.add(actor,asset,0);await ready;assert.throws(()=>createBrandCatalog(options),/already owned/);
 let closed=false;const closing=brand.close().then(()=>closed=true);await Promise.resolve();assert.equal(closed,false);await assert.rejects(brand.get(actor,asset.id),/closed/);release();await work;await closing;assert.equal(catalog.size,1);
 const replacement=createBrandCatalog({...options,audit:{append:async()=>{}}});try{await brand.close();assert.throws(()=>createBrandCatalog(options),/already owned/);}finally{await replacement.close();}
});
