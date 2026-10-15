import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {checkConsumerSelection,checkEntryTargets} from './workspace-public-consumer.mjs';
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
 pkg.exports['./evil']='../../outside.js';
 pkg.exports['./escape']='./dist/../../outside.js';
 assert.ok(checkEntryTargets(dir,pkg).includes('../../outside.js'));
 assert.ok(checkEntryTargets(dir,pkg).includes('./dist/../../outside.js'));
});
