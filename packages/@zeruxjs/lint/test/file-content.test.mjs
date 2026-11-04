import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,symlink,unlink,rm} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';
import {readLintSource,writeLintSource} from '../dist/file-content.js';
test('explicit lint fixes reject replacement links and concurrent source changes',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'lint-file-'));
 try{
  const file=path.join(root,'source.css'),other=path.join(root,'other');await writeFile(file,'a{}');await writeFile(other,'retain');
  const original=await readLintSource(file);await writeLintSource(file,original,'a { color: red; }');assert.equal(await readFile(file,'utf8'),'a { color: red; }');
  await assert.rejects(writeLintSource(file,original,'wrong'),/changed/);
  await unlink(file);await symlink(other,file);await assert.rejects(writeLintSource(file,'retain','wrong'));
  assert.equal(await readFile(other,'utf8'),'retain');await assert.rejects(readLintSource(other,1),/size/);
 }finally{await rm(root,{recursive:true,force:true});}
});
