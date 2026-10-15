import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { discoverLintFiles, loadLintConfig } from '../dist/index.js';

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
