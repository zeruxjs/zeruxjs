const { test } = require('node:test'); const assert=require('node:assert/strict');
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const db=require('../dist/index.js');
const {createDatabaseManager}=db; const {getPathValue,assertJsonSerializable}=require('../dist/utils.js');
test('references never traverse object prototypes',()=>{
 assert.equal(getPathValue({a:{v:1}},'a.v'),1);
 assert.equal(getPathValue({},'constructor.prototype'),undefined);
 assert.equal(getPathValue([1,2],'0junk'),undefined);
 assert.throws(()=>assertJsonSerializable({a:undefined},'input'));
});
test('failed database manager initialization disconnects earlier connectors', async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zx-db-manager-'));
 const previous=process.cwd();
 try {
  fs.writeFileSync(path.join(root,'package.json'),'{}');
  const mod=path.join(root,'node_modules','test-first');fs.mkdirSync(mod,{recursive:true});
  const recorded=path.join(root,'closed');
  fs.writeFileSync(path.join(mod,'index.js'),`exports.createConnector=()=>({kind:'fake',options:{},connect(){},disconnect(){require('node:fs').writeFileSync(${JSON.stringify(recorded)},'yes')},execute(){return {ok:true}}});`);
  const fail=path.join(root,'node_modules','test-second'); fs.mkdirSync(fail,{recursive:true});
  fs.writeFileSync(path.join(fail,'index.js'),`exports.createConnector=()=>({kind:'fake',options:{},connect(){throw Error('connect exploded')},disconnect(){}});`);
  process.chdir(root);
  await assert.rejects(createDatabaseManager({connections:[{slug:'a',name:'A',connector:'test-first'},{slug:'b',name:'B',connector:'test-second'}],default:'a'}),/connect exploded/);
  assert.equal(fs.readFileSync(recorded,'utf8'),'yes');
  const manager=await createDatabaseManager({connections:[{slug:'a',name:'A',connector:'test-first'}]});
  await manager.disconnect();await manager.disconnect();
  assert.throws(()=>manager.dbAccess('a'),/disconnected/);
 } finally {process.chdir(previous);fs.rmSync(root,{recursive:true,force:true});}
});

test('connection summaries hide URI credentials and nested secrets',()=>{
 const {redactConnectionOptions}=require('../dist/utils.js');
 const shown=redactConnectionOptions({ uri:'mongodb://admin:pass@localhost:27017',options:{password:'secret',safe:true},client:{socket:'secret'} });
 assert.equal(shown.uri,'[redacted]');assert.equal(shown.options.password,'[redacted]');assert.equal(shown.options.safe,true);assert.equal(shown.client,'[redacted]');
});
