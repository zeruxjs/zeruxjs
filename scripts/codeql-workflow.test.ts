import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/** Local value for workflow. */
const workflow = await readFile(
  new URL('../.github/workflows/codeql.yml', import.meta.url),
  'utf8'
);

/** Local value for source. */
const source = workflow.slice(workflow.indexOf('  analyze:'));
/** Local value for security. */
const security = await readFile(
  new URL('../.github/workflows/security.yml', import.meta.url),
  'utf8'
);
// Preserve the default-branch workflow/job identity for comparable PR analyses.
test('CodeQL scans TypeScript/JavaScript and workflow actions with security-and-quality queries', () => {
  assert.match(source, /language:\s*\[javascript-typescript,\s*actions\]/);
  assert.match(source, /queries:\s*security-and-quality/);
  assert.match(source, /github\/codeql-action\/init@[a-f0-9]{40}/);
  assert.match(source, /github\/codeql-action\/analyze@[a-f0-9]{40}/);
  assert.match(source, /build-mode:\s*none/);
  assert.match(
    source,
    /category:\s*\/language:\$\{\{\s*matrix\.language\s*\}\}/
  );
});
test('CodeQL runs on PR, push, merge queue, manual and daily schedule without privileged triggers', () => {
  assert.match(workflow, /^ {2}push:\s*$/m);
  assert.match(workflow, /^ {2}pull_request:\s*$/m);
  assert.match(workflow, /^ {2}merge_group:\s*$/m);
  assert.match(workflow, /^ {2}schedule:\s*$/m);
  assert.match(workflow, /^ {2}workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*pull_request_target\s*:/m);
  assert.doesNotMatch(workflow, /^\s*workflow_run\s*:/m);
});
test('CodeQL has no repo write scope, secrets or npm dependency precondition', () => {
  assert.match(source, /contents:\s*read/);
  assert.match(source, /security-events:\s*write/);
  assert.match(source, /persist-credentials:\s*false/);
  assert.match(workflow, /cancel-in-progress:/);
  assert.doesNotMatch(
    source,
    /^\s*(?:run|working-directory):.*(?:npm|npx|pnpm|yarn)\s/m
  );
  assert.doesNotMatch(
    source,
    /^\s*(?:packages|deployments|id-token|contents):\s*write\s*$/m
  );
});

test('CodeQL keeps its baseline identity and is not duplicated in security workflow', () => {
  assert.match(workflow, /^ {2}analyze:/m);
  assert.doesNotMatch(security, /github\/codeql-action\/(?:init|analyze)@/);
});

// Exact release comments keep immutable pins auditable when upstream major tags move.
test('security action pins retain their verified immutable release annotations', async () => {
  /** Security entry points share CodeQL upload and dependency-review action pins. */
  const files = [
    'codeql.yml',
    'security.yml',
    'runtime-security.yml',
    'scorecard.yml',
    'dependency-review.yml',
  ];
  // Check every occurrence rather than accepting one correct annotation per file.
  for (const filename of files) {
    /** Authored workflow content; no remote actions or application code execute. */
    const content = await readFile(
      new URL(`../.github/workflows/${filename}`, import.meta.url),
      'utf8'
    );
    // Match only the two upstream commits whose release identities were verified.
    for (const line of content.split('\n')) {
      if (line.includes('33d7b85da1a04171e211befe2c739303b9a4c066')) {
        assert.match(line, /# v4\.39\.3$/);
      }
      if (line.includes('a1d282b36b6f3519aa1f3fc636f609c47dddb294')) {
        assert.match(line, /# v5\.0\.0$/);
      }
    }
  }
});
