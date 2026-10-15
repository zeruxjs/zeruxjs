import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source = await readFile(new URL('../.github/workflows/codeql.yml',import.meta.url),'utf8');

// Intentionally dependency-free: usable in the isolated source preflight
// while npm registry dependencies remain unresolved (Section 66).
test('CodeQL scans TypeScript/JavaScript and workflow actions with security-and-quality queries',()=>{
  assert.match(source,/language:\s*\[javascript-typescript,\s*actions\]/);
  assert.match(source,/uses:\s*security-and-quality/);
  assert.match(source,/github\/codeql-action\/init@v4/);
  assert.match(source,/github\/codeql-action\/analyze@v4/);
  assert.match(source,/build-mode:\s*none/);
  assert.match(source,/category:\s*\/language:\$\{\{\s*matrix\.language\s*\}\}/);
});
test('CodeQL runs on PR, push, merge queue, manual and weekly schedule without privileged triggers',()=>{
  assert.match(source,/^  push:\s*$/m);
  assert.match(source,/^  pull_request:\s*$/m);
  assert.match(source,/^  merge_group:\s*$/m);
  assert.match(source,/^  schedule:\s*$/m);
  assert.match(source,/^  workflow_dispatch:\s*$/m);
  assert.doesNotMatch(source,/^\s*pull_request_target\s*:/m);
  assert.doesNotMatch(source,/^\s*workflow_run\s*:/m);
});
test('CodeQL has no repo write scope, secrets or npm dependency precondition',()=>{
  assert.match(source,/permissions:\s*\{\}/);
  assert.match(source,/security-events:\s*write/);
  assert.match(source,/persist-credentials:\s*false/);
  assert.match(source,/cancel-in-progress:/);
  assert.doesNotMatch(source,/^\s*(?:run|working-directory):.*(?:npm|npx|pnpm|yarn)\s/m);
  assert.doesNotMatch(source,/^\s*(?:packages|deployments|id-token|contents):\s*write\s*$/m);
});
