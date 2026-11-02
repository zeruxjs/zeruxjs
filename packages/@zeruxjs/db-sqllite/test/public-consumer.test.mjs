import test from 'node:test';import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,readdirSync,readFileSync,writeFileSync,rmSync,symlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';import { fileURLToPath } from 'node:url';import os from 'node:os';import path from 'node:path';
test('packed sync API declarations and disposable README example use public imports',()=>{
 const pkg=fileURLToPath(new URL('..',import.meta.url)),root=path.resolve(pkg,'../../..'),dir=mkdtempSync(path.join(os.tmpdir(),'sqlite-public-'));
 try{
 const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--cache',path.join(dir,'cache'),'--pack-destination',dir,'--json'],{cwd:pkg,encoding:'utf8'}));const info=Array.isArray(packed)?packed[0]:Object.values(packed)[0];
 const scope=path.join(dir,'node_modules','@zeruxjs'),installed=path.join(scope,'db-sqlite');mkdirSync(installed,{recursive:true});execFileSync('tar',['-xzf',path.join(dir,info.filename),'-C',installed,'--strip-components=1']);
 for(const name of readdirSync(path.join(root,'node_modules')))if(!['.bin','@zeruxjs'].includes(name))symlinkSync(path.join(root,'node_modules',name),path.join(dir,'node_modules',name));
 for(const name of readdirSync(path.join(root,'node_modules','@zeruxjs')))if(name!=='db-sqlite')symlinkSync(path.join(root,'node_modules','@zeruxjs',name),path.join(scope,name));
 writeFileSync(path.join(dir,'package.json'),'{"type":"module"}');const example=readFileSync(path.join(pkg,'README.md'),'utf8').split('## Synchronous transactions')[1].match(/```ts\n([\s\S]*?)```/)[1];
 writeFileSync(path.join(dir,'example.ts'),example+`\nfunction compileOnly(db:SqliteConnector){\n// @ts-expect-error async callbacks cannot cross synchronous transaction scope\ndb.transactionSync(async()=>{});\n}\n`);
 execFileSync(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'--strict','--types','node','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','example.ts'],{cwd:dir,encoding:'utf8'});
 execFileSync(process.execPath,['example.js'],{cwd:dir,encoding:'utf8'});
 const script=`const Module=require('node:module');const original=Module._load;Module._load=function(name,...args){if(name==='node:sqlite')throw Error('eager native import');return original.call(this,name,...args);};const api=require(${JSON.stringify(path.join(installed,'dist/index.js'))});if(typeof api.createConnector!=='function')throw Error('missing factory');`;
 execFileSync(process.execPath,['-e',script],{cwd:dir,encoding:'utf8'});assert.equal(JSON.parse(readFileSync(path.join(installed,'package.json'))).name,'@zeruxjs/db-sqlite');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
