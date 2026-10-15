import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { createTsConfig, transformTypescript, transpileTypescriptFile, checkTypes, registerTypescript } from '../dist/index.js';
import { load } from '../dist/loader.js';

test('transpile ESM and CJS and detect syntax errors', () => {
  assert.match(transformTypescript('const n: number = 2; export { n };').code, /export/);
  assert.match(transformTypescript('const n: number = 2; export { n };',{format:'cjs'}).code, /exports/);
  assert.throws(() => transformTypescript('const = :'), /error/i);
});
test('safe tsconfig generation does not overwrite existing settings', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'zerux-tsconfig-'));
  try {
    const file = createTsConfig(dir, {compilerOptions:{noUnusedLocals:true}});
    assert.equal(JSON.parse(fs.readFileSync(file)).compilerOptions.noUnusedLocals,true);
    fs.writeFileSync(file,'{"private":true}'); createTsConfig(dir);
    assert.equal(fs.readFileSync(file,'utf8'),'{"private":true}');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('checkTypes reports actual type errors without emitting files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'zerux-types-'));
  try {
    fs.writeFileSync(path.join(dir,'bad.ts'),"const value: number = 'bad';\n");
    const result = checkTypes({cwd:dir,files:['bad.ts']});
    assert.equal(result.ok,false); assert.ok(result.diagnostics.length);
    assert.ok(!fs.existsSync(path.join(dir,'bad.js')));
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('CommonJS loader compiles TypeScript and restores previous handler', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'zerux-cjs-'));
  try {
    const file = path.join(dir,'entry.ts'); fs.writeFileSync(file, 'module.exports = { result: (4 as number) + 2 };');
    const req = createRequire(import.meta.url);
    const previous = req.extensions['.ts'];
    const restore = registerTypescript();
    assert.equal(req(file).result,6);
    restore(); assert.equal(req.extensions['.ts'],previous);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
test('ESM loader handles .ts and delegates .js without importing arbitrary protocols', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'zerux-esm-'));
  try {
    const file = path.join(dir,'module.ts'); fs.writeFileSync(file,'export const answer: number = 42;');
    const result = await load(pathToFileURL(file).href, {}, () => { throw new Error('not delegated'); });
    assert.equal(result.format,'module'); assert.match(result.source,/42/);
    const fallback = await load('data:text/javascript,hello', {}, async () => ({format:'module',source:'hello'}));
    assert.equal(fallback.source,'hello');
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});
