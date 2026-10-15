import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createZuix,extractClasses} from '../dist/index.js';
import {buildZuix} from '../dist/node.js';
const compiler=createZuix({preflight:false});
const css=compiler.generate(['p-4','p-4','animate-spin','cq-md:gap-2','supports-[display:grid]:grid','starting:opacity-0','media-[width>=40rem]:flex']);
assert.equal(css.css.match(/\.p-4\{/g)?.length,1,'identical tokens must emit once');
assert.match(css.css,/@container \(min-width: 768px\)/);
assert.match(css.css,/@supports \(display:grid\)/);
assert.match(css.css,/@starting-style/);
assert.match(css.css,/@keyframes zuix-spin/);
assert.doesNotMatch(css.css,/@keyframes zuix-pulse/);
assert.deepEqual(css.unmatched,[]);
assert(extractClasses('<div class="p-4 hover:bg-blue-500"></div>').includes('p-4'));
const root=mkdtempSync(join(tmpdir(),'zuix-smoke-'));
try{
 mkdirSync(join(root,'src'));
 writeFileSync(join(root,'src','a.html'),'<div class="p-4 text-red-500"></div>');
 writeFileSync(join(root,'src','b.tsx'),'export const X=()=> <b className="p-4 flex"/>');
 const result=buildZuix(root,{preflight:false,perFile:true,content:['src/**/*.{html,tsx}']});
 assert.equal(result.css.match(/\.p-4\{/g)?.length,1);
 assert.match(readFileSync(join(root,'zuix-files/src/a.html.css'),'utf8'),/text-red-500/);
 assert.doesNotMatch(readFileSync(join(root,'zuix-files/src/b.tsx.css'),'utf8'),/text-red-500/);
 assert(existsSync(join(root,'zuix-files/manifest.json')));
 console.log('Zuix smoke tests passed');
}finally{rmSync(root,{recursive:true,force:true});}
