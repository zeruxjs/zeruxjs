import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {doctorMain,inspectDeveloperWorkspace} from './doctor.mjs';
/**
 * Title: Create a controlled doctor workspace.
 * Description: Exercises missing and resolved dependency locks independently of the repository's current readiness.
 * Global Variables: Uses the OS temporary directory and test cleanup filesystem operations; reads no environment variables.
 * @param t Node test context used to remove the fixture.
 * @param resolved Whether to include the external dependency's locked resolution.
 * @returns Temporary workspace directory.
 */
function fixture(t, resolved = false) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zerux-doctor-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const manifest={name:'doctor-fixture',private:true,workspaces:['packages/*']};
 const pkg={name:'example',version:'1.0.0',main:'./dist/index.js',scripts:{build:'tsc'},dependencies:{'external-example':'1.0.0'}};
 fs.mkdirSync(path.join(root,'packages/example'),{recursive:true});
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify(manifest));
 fs.writeFileSync(path.join(root,'packages/example/package.json'),JSON.stringify(pkg));
 const packages={'':manifest,'packages/example':pkg,'node_modules/example':{resolved:'packages/example',link:true}};
 if(resolved) packages['node_modules/external-example']={version:'1.0.0',resolved:'https://registry.npmjs.org/external-example/-/external-example-1.0.0.tgz',integrity:'sha512-Zml4dHVyZQ=='};
 fs.writeFileSync(path.join(root,'package-lock.json'),JSON.stringify({name:manifest.name,lockfileVersion:3,packages}));
 return root;
}
test('read-only doctor reports clean install blockers distinctly from source contracts',t=>{
 const root=fixture(t);
 const before=fs.readFileSync(path.join(root,'package-lock.json'),'utf8');
 const result=inspectDeveloperWorkspace(root);
 assert.equal(result.workspaces,1);
 assert.equal(result.plannedBuilds,1);
 assert.equal(result.sourceContracts.ok,true);
 assert.equal(result.readyForCleanInstall,false);
 assert.deepEqual(result.lock.unresolvedExternal,[{name:'external-example',requiredBy:['example']}]);
 assert.match(result.note,/Clean npm ci/);
 assert.equal(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'),before);
});
test('doctor supports JSON, strict gates and invalid options without editing files',t=>{
 for(const resolved of [false,true]) {
  const root=fixture(t,resolved);
  const before=fs.readFileSync(path.join(root,'package-lock.json'),'utf8');
  const values=[],errors=[];
  assert.equal(doctorMain(['--json'],root,m=>values.push(m),m=>errors.push(m)),0);
  assert.equal(JSON.parse(values[0]).readyForCleanInstall,resolved);
  assert.equal(doctorMain(['--strict'],root,()=>{},()=>{}),resolved?0:1);
  assert.equal(doctorMain(['--not-a-flag'],root,()=>{},m=>errors.push(m)),2);
  assert.equal(errors.length,1);
  assert.equal(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'),before);
 }
});
