import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverLintFiles, loadLintConfig } from '../dist/index.js';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('discovers nested source files while skipping build output and symlinks', () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'zerux-lint-'));
  try {
    for(const dir of ['src','dist','node_modules','src/nested']) fs.mkdirSync(path.join(root,dir),{recursive:true});
    fs.writeFileSync(path.join(root,'src/a.ts'),'const a = 1;');
    fs.writeFileSync(path.join(root,'src/nested/b.css'),'body {}');
    fs.writeFileSync(path.join(root,'dist/c.js'),'');
    fs.writeFileSync(path.join(root,'node_modules/d.js'),'');
    fs.symlinkSync(path.join(root,'dist'),path.join(root,'src/linked'));
    assert.deepEqual(discoverLintFiles(root).map(s=>path.relative(root,s)),['src/a.ts','src/nested/b.css']);
    assert.throws(()=>discoverLintFiles(root,{maxFiles:1}),/exceeds/);
    assert.throws(()=>discoverLintFiles(root,{files:['../outside']}),/escapes/);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
test('loads JSON project configuration and refuses symlink configs',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'zerux-lintcfg-'));
  try {
    assert.deepEqual(await loadLintConfig(root),{});
    const file=path.join(root,'lint.zerux.json'); fs.writeFileSync(file,JSON.stringify({fix:true}));
    assert.deepEqual(await loadLintConfig(root),{fix:true});
    fs.unlinkSync(file); fs.symlinkSync(path.join(root,'missing'),file);
    await assert.rejects(()=>loadLintConfig(root));
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('licensed media adapter preserves SCSS operator diagnostics and source positions',async()=>{
  const stylelint = (await import('stylelint')).default;
  const scss = (await import('stylelint-scss')).default;
  const ruleName = 'scss/operator-no-unspaced';
  const cases = [
    ['@media (min-width: $size + 1px) { a {} }', 0],
    ['@media (min-width: $size+1px) { a {} }', 2],
    ['@media (min-width: calc($size+1px)) { a {} }', 2],
    ['@media #{$kind+1} and (width: $size+1) { a {} }', 4],
    ['@import url(10px +2);', 1],
    ['@import url("font(1).css") screen and (width: $size+1);', 2],
    ['@media screen /* (ignored: value) */ and (width: $size+1) { a {} }', 2]
  ];
  for (const [code, count] of cases) {
    const output = await stylelint.lint({code, customSyntax:'postcss-scss', config:{plugins:[scss],rules:{[ruleName]:true}}});
    const warnings = output.results[0].warnings;
    assert.equal(warnings.length,count,code);
    for (const warning of warnings) {
      // PostCSS strips comments from params before the upstream rule computes offsets.
      if (!code.includes('/*')) assert.equal(code[warning.column - 1], '+', `Incorrect source offset: ${code}`);
    }
  }
  // Resolve from the plugin to verify that the licensed adapter is installed.
  const pluginRequire = createRequire(require.resolve('stylelint-scss'));
  const manifest = pluginRequire('postcss-media-query-parser/package.json');
  assert.equal(manifest.name,'@zeruxjs/scss-media-parser');
});
