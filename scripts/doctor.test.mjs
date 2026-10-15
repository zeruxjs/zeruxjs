import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {doctorMain,inspectDeveloperWorkspace} from './doctor.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('read-only doctor reports clean install blockers distinctly from source contracts',()=>{
 const result=inspectDeveloperWorkspace(root);
 assert.ok(result.workspaces>=40);
 assert.ok(result.plannedBuilds>=40);
 assert.equal(result.sourceContracts.ok,true);
 assert.equal(result.readyForCleanInstall,false);
 assert.ok(result.lock.unresolvedExternal.length>0);
 assert.match(result.note,/Clean npm ci/);
});
test('doctor supports JSON, strict gates and invalid options without editing files',()=>{
 const values=[],errors=[];
 assert.equal(doctorMain(['--json'],root,m=>values.push(m),m=>errors.push(m)),0);
 assert.equal(JSON.parse(values[0]).readyForCleanInstall,false);
 assert.equal(doctorMain(['--strict'],root,()=>{},()=>{}),1);
 assert.equal(doctorMain(['--not-a-flag'],root,()=>{},m=>errors.push(m)),2);
 assert.equal(errors.length,1);
});
