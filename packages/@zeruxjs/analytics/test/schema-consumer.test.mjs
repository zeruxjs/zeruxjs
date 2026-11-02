import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
test('packed schema declarations infer dimensions/metrics; browser import has no Node graph',()=>{
 const pkg=fileURLToPath(new URL('..',import.meta.url)),root=path.resolve(pkg,'../../..'),dir=mkdtempSync(path.join(os.tmpdir(),'analytics-schema-consumer-'));
 try{
 const packed=JSON.parse(execFileSync('npm',['pack','--ignore-scripts','--cache',path.join(dir,'cache'),'--pack-destination',dir,'--json'],{cwd:pkg,encoding:'utf8'}));const info=Array.isArray(packed)?packed[0]:Object.values(packed)[0];
 const scope=path.join(dir,'node_modules','@zeruxjs'),installed=path.join(scope,'analytics');mkdirSync(installed,{recursive:true});execFileSync('tar',['-xzf',path.join(dir,info.filename),'-C',installed,'--strip-components=1']);
 for(const name of readdirSync(path.join(root,'node_modules')))if(!['.bin','@zeruxjs'].includes(name))symlinkSync(path.join(root,'node_modules',name),path.join(dir,'node_modules',name));
 writeFileSync(path.join(dir,'package.json'),'{"type":"module"}');
 const example=readFileSync(path.join(pkg,'examples/versioned-events.ts'),'utf8')+'\n'+readFileSync(path.join(pkg,'examples/analysis.ts'),'utf8');
 writeFileSync(path.join(dir,'example.ts'),example+`
// @ts-expect-error unknown finite dimension value
schemas.event('page.view', {properties:{section:'private'}});
// @ts-expect-error missing required dimension
schemas.event('page.view', {properties:{duration_ms:2}});
// @ts-expect-error wrong metric type
schemas.event('page.view', {properties:{section:'docs',duration_ms:'2'}});
// @ts-expect-error unregistered event name
schemas.event('private.event', {properties:{section:'docs'}});
`);
 execFileSync(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--types','node','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','example.ts'],{cwd:dir,encoding:'utf8'});
 symlinkSync(path.join(root,'packages/@zeruxjs/db'),path.join(scope,'db'));
 writeFileSync(path.join(dir,'durable.ts'),readFileSync(path.join(pkg,'examples/durable.ts'),'utf8'));
 execFileSync(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--types','node','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','durable.ts'],{cwd:dir,encoding:'utf8'});
 writeFileSync(path.join(dir,'browser.ts'),"import {createEventClient} from '@zeruxjs/analytics/browser';\ncreateEventClient({endpoint:'https://events.test',enabled:false});\n");
 execFileSync(process.execPath,[path.join(root,'node_modules/typescript/bin/tsc'),'--noEmit','--strict','--types','node','--target','ES2022','--module','NodeNext','--moduleResolution','NodeNext','browser.ts'],{cwd:dir,encoding:'utf8'});
 const browser=readFileSync(path.join(installed,'dist/browser.js'),'utf8');assert.doesNotMatch(browser,/\b(?:import|require\s*\()|\b(?:Buffer|process)\b/);
 execFileSync(process.execPath,['--input-type=module','-e',"import {createEventClient} from '@zeruxjs/analytics/browser'; createEventClient({endpoint:'https://events.test',enabled:false});"],{cwd:dir,encoding:'utf8',timeout:5000});
 }finally{rmSync(dir,{recursive:true,force:true});}
});
