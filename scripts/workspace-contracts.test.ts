import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspectWorkspaceContracts } from './workspace-contracts.ts';

/** Perform the setup operation.
 * @param {unknown} t - Input value for t.
 * @param {unknown} pkg - Input value for pkg.
 * @returns {unknown} Result produced by setup.
 */
function setup(t, pkg) {
  /** Local value for root. */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zerux-contract-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ workspaces: ['packages/*'] })
  );
  /** Local value for dir. */
  const dir = path.join(root, 'packages/alpha');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'alpha', version: '1.0.0', ...pkg })
  );
  return { root, dir };
}

test('generated dist entrypoints are deferred to postbuild artifact checks', (t) => {
  /** Local value for destructured values. */
  const { root } = setup(t, {
    main: './dist/index.js',
    types: './dist/index.d.ts',
    exports: { '.': './dist/index.js' },
  });
  assert.deepEqual(inspectWorkspaceContracts(root).problems, []);
});

test('non-generated public assets must be present in source snapshots', (t) => {
  /** Local value for destructured values. */
  const { root, dir } = setup(t, {
    exports: { './schema': './assets/schema.json' },
  });
  assert.match(
    inspectWorkspaceContracts(root).problems[0].reason,
    /Missing committed asset/
  );
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets/schema.json'), '{}');
  assert.equal(inspectWorkspaceContracts(root).ok, true);
});

test('public contract checks reject path traversal and absolute targets', (t) => {
  /** Local value for destructured values. */
  const { root } = setup(t, {
    exports: { '.': './../../outside.js', './other': '/etc/passwd' },
  });
  /** Local value for reasons. */
  const reasons = inspectWorkspaceContracts(root).problems.map(
    (item) => item.reason
  );
  assert.ok(reasons.some((value) => /Invalid package entrypoint/.test(value)));
  assert.ok(reasons.some((value) => /escapes package/.test(value)));
});

test('real framework config schema export exists and is valid JSON Schema', () => {
  /** Local value for schema path. */
  const schemaPath = path.resolve(
    import.meta.dirname,
    '../packages/zeruxjs/assets/json/schema.config.json'
  );
  /** Local value for schema. */
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.properties.structure.properties.app.type, 'string');
});
