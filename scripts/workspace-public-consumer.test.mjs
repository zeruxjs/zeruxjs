import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkConsumerSelection,checkEntryTargets,createConsumerLock} from './workspace-public-consumer.mjs';
const plan={ok:true,publicPackages:2,order:[{name:'pkg-a'},{name:'pkg-b'}]};
test('default requires every public package; scopes are explicit',()=>{
 assert.deepEqual(checkConsumerSelection(plan),['pkg-a','pkg-b']);
 assert.deepEqual(checkConsumerSelection(plan,'pkg-b'),['pkg-b']);
 for(const value of ['pkg-c','pkg-a,pkg-a',',pkg-b']) assert.throws(()=>checkConsumerSelection(plan,value));
 assert.throws(()=>checkConsumerSelection({...plan,ok:false}));
});
test('exports, bins, declarations and all conditional targets must be built',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'consumer-targets-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const pkg={main:'./dist/index.js',types:'./dist/index.d.ts',exports:{'.':{import:'./dist/index.js',types:'./dist/index.d.ts'},'./node':'./dist/node.js'},bin:{x:'./dist/bin.js'}};
 assert.deepEqual(checkEntryTargets(dir,pkg).sort(),['./dist/bin.js','./dist/index.d.ts','./dist/index.js','./dist/node.js'].sort());
 fs.mkdirSync(path.join(dir,'dist'));for(const name of ['index.js','index.d.ts','node.js','bin.js'])fs.writeFileSync(path.join(dir,'dist',name),'');
 assert.deepEqual(checkEntryTargets(dir,pkg),[]);
 pkg.exports['./schema']='./assets/json/schema.config.json';
 assert.deepEqual(checkEntryTargets(dir,pkg),['./assets/json/schema.config.json']);
 fs.mkdirSync(path.join(dir,'assets/json'),{recursive:true});
 fs.writeFileSync(path.join(dir,'assets/json/schema.config.json'),'{}');
 assert.deepEqual(checkEntryTargets(dir,pkg),[]);
 pkg.exports['./evil']='../../outside.js';
 pkg.exports['./escape']='./dist/../../outside.js';
 assert.ok(checkEntryTargets(dir,pkg).includes('../../outside.js'));
 assert.ok(checkEntryTargets(dir,pkg).includes('./dist/../../outside.js'));
});

// Locked installs must work with a tarball-only npm cache, without range metadata.
test('consumer lock keeps reviewed external resolutions and replaces workspace links with real archives',()=>{
 const types={version:'25.6.0',resolved:'https://registry.npmjs.org/@types/node/-/node-25.6.0.tgz',integrity:'sha512-bm9kZQ==',dependencies:{'undici-types':'~7.19.0'}};
 const undici={version:'7.19.2',resolved:'https://registry.npmjs.org/undici-types/-/undici-types-7.19.2.tgz',integrity:'sha512-dHlwZXM='};
 const external={version:'1.2.3',resolved:'https://registry.npmjs.org/external/-/external-1.2.3.tgz',integrity:'sha512-ZXh0ZXJuYWw='};
 const pkg={name:'pkg-a',version:'0.0.1',dependencies:{external:'^1.0.0'},devDependencies:{typescript:'^5.9.3'}};
 const source={lockfileVersion:3,packages:{'':{workspaces:['packages/*']},'node_modules/pkg-a':{link:true,resolved:'packages/pkg-a'},'packages/pkg-a':pkg,'node_modules/@types/node':types,'node_modules/undici-types':undici,'packages/pkg-a/node_modules/external':{version:external.version},'packages/build-only/node_modules/external':external}};
 const before=JSON.stringify(source);
 const archives=[{pkg,relativeDir:'packages/pkg-a',tarball:path.resolve(os.tmpdir(),'pkg with spaces.tgz'),integrity:'sha512-YXJjaGl2ZQ=='}];
 const {manifest,lock}=createConsumerLock(source,archives);
 assert.equal(manifest.dependencies['@types/node'],'25.6.0');
 assert.equal(lock.packages['node_modules/pkg-a'].resolved,manifest.dependencies['pkg-a']);
 assert.equal(lock.packages['node_modules/pkg-a'].integrity,archives[0].integrity);
 assert.equal(lock.packages['node_modules/pkg-a'].link,undefined);
 assert.equal(lock.packages['node_modules/pkg-a'].devDependencies,undefined);
 assert.deepEqual(lock.packages['node_modules/pkg-a/node_modules/external'],external);
 assert.deepEqual(lock.packages['node_modules/@types/node'],types);
 assert.deepEqual(lock.packages['node_modules/undici-types'],undici);
 assert.equal(JSON.stringify(source),before);
 assert.throws(()=>createConsumerLock({lockfileVersion:3,packages:{}},archives),/committed resolution|baseline/);
 const sourceRoot=path.resolve(os.tmpdir(),'reviewed source');
 external.resolved='file:vendor/external.tgz';
 assert.throws(()=>createConsumerLock(source,archives),/requires sourceRoot/);
 const local=createConsumerLock(source,archives,{sourceRoot});
 assert.equal(local.lock.packages['node_modules/pkg-a/node_modules/external'].resolved,
   pathToFileURL(path.join(sourceRoot,'vendor/external.tgz')).href);
 external.resolved='file:../outside.tgz';
 assert.throws(()=>createConsumerLock(source,archives,{sourceRoot}),/escapes sourceRoot/);
});
