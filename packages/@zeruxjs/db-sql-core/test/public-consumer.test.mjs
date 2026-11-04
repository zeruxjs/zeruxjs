import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
test('packed public compiler declarations and README example work without source aliases',()=>{
 const pkg=fileURLToPath(new URL('..',import.meta.url)),root=path.resolve(pkg,'../../..'),dir=mkdtempSync(path.join(os.tmpdir(),'sql-core-public-'));
 try{
 const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--cache',path.join(dir,'cache'),'--pack-destination',dir,'--json'],{cwd:pkg,encoding:'utf8'}));const info=Array.isArray(packed)?packed[0]:Object.values(packed)[0];
 const scope=path.join(dir,'node_modules','@zeruxjs'),installed=path.join(scope,'db-sql-core');mkdirSync(installed,{recursive:true});execFileSync('tar',['-xzf',path.join(dir,info.filename),'-C',installed,'--strip-components=1']);
 for(const name of readdirSync(path.join(root,'node_modules')))if(!['.bin','@zeruxjs'].includes(name))symlinkSync(path.join(root,'node_modules',name),path.join(dir,'node_modules',name));
 for(const name of readdirSync(path.join(root,'node_modules','@zeruxjs')))if(name!=='db-sql-core')symlinkSync(path.join(root,'node_modules','@zeruxjs',name),path.join(scope,name));
 writeFileSync(path.join(dir,'package.json'),'{"type":"module"}');
 const example=readFileSync(path.join(pkg,'README.md'),'utf8').match(/```ts\n([\s\S]*?)```/)[1];writeFileSync(path.join(dir,'example.ts'),example);
 execFileSync(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'--strict','--types','node','--module','NodeNext','--moduleResolution','NodeNext','--target','ES2022','example.ts'],{cwd:dir,encoding:'utf8'});
 assert.match(execFileSync(process.execPath,['example.js'],{cwd:dir,encoding:'utf8'}),/\$3/);assert.equal(existsSync(path.join(installed,'src')),false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
