import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from '../dist/loader/loader.js';
import { register, unregister } from '../dist/loader/registry.js';
import { registerPath } from '@zeruxjs/hooks';
test('standard URLs, builtins and ordinary modules delegate unchanged; custom aliases remain validated', async () => {
  const context = {
      parentURL: 'file:///tmp/parent.mjs',
      conditions: ['node', 'import'],
    },
    calls = [];
  const next = async (s, c) => {
    calls.push(s);
    assert.equal(c, context);
    return { url: s };
  };
  register('file', () => {
    throw Error('must not intercept Node file URLs');
  });
  try {
    for (const specifier of [
      'file:///tmp/app/zerux.config.mjs',
      'node:fs',
      'data:text/javascript,export default 1',
      'https://example.test/source.mjs',
      'react',
      '@zeruxjs/react/server',
      './view.mjs',
      '../entry.ts',
    ])
      assert.deepEqual(await resolve(specifier, context, next), {
        url: specifier,
      });
    assert.equal(calls.length, 8);
  } finally {
    unregister('file');
  }
  const previous = process.cwd(),
    root = mkdtempSync(join(tmpdir(), 'zx086-loader-'));
  try {
    process.chdir(root);
    writeFileSync(join(root, 'entry.mjs'), 'export default 1');
    registerPath('app:entry', join(root, 'entry.mjs'));
    assert.deepEqual(await resolve('app:entry', context, next), {
      url: join(root, 'entry.mjs'),
    });
    await assert.rejects(
      resolve('app:../secret', context, next),
      /Invalid path alias/,
    );
  } finally {
    process.chdir(previous);
    rmSync(root, { recursive: true, force: true });
  }
});
