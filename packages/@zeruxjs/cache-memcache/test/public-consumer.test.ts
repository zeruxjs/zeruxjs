import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
test('packed public Memcached helper declarations and README example compile', () => {
  /** Package root used to pack only the public archive. */
  const pkg = fileURLToPath(new URL('..', import.meta.url));
  /** Repository root supplying the compiler and development dependencies. */
  const root = path.resolve(pkg, '../../..');
  /** Owned temporary consumer/cache removed in finally. */
  const dir = mkdtempSync(path.join(os.tmpdir(), 'memcache-public-'));
  try {
    /** npm pack metadata obtained without lifecycle scripts. */
    const packed = JSON.parse(
      execFileSync(
        'npm',
        [
          'pack',
          '--ignore-scripts',
          '--cache',
          path.join(dir, 'cache'),
          '--pack-destination',
          dir,
          '--json',
        ],
        { cwd: pkg, encoding: 'utf8' }
      )
    );
    /** Archive descriptor supporting npm array and object output. */
    const info = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
    /** Temporary scope directory keeping the packed package distinct. */
    const scope = path.join(dir, 'node_modules', '@zeruxjs');
    /** Extracted public Memcached package used by the consumer. */
    const installed = path.join(scope, 'cache-memcache');
    mkdirSync(installed, { recursive: true });
    execFileSync('tar', [
      '-xzf',
      path.join(dir, info.filename),
      '-C',
      installed,
      '--strip-components=1',
    ]);
    // Link compiler dependencies without replacing the packed package under test.
    for (const name of readdirSync(path.join(root, 'node_modules'))) {
      if (!['.bin', '@zeruxjs'].includes(name)) {
        symlinkSync(
          path.join(root, 'node_modules', name),
          path.join(dir, 'node_modules', name)
        );
      }
    }
    // Preserve the extracted Memcached package while linking other scoped dependencies.
    for (const name of readdirSync(
      path.join(root, 'node_modules', '@zeruxjs')
    )) {
      if (name !== 'cache-memcache') {
        symlinkSync(
          path.join(root, 'node_modules', '@zeruxjs', name),
          path.join(scope, name)
        );
      }
    }
    writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    /** Authored direct-helper example compiled but not called against an external server. */
    const example = readFileSync(path.join(pkg, 'README.md'), 'utf8')
      .split('## Bounded direct helper')[1]
      .match(/```ts\n([\s\S]*?)```/)[1];
    writeFileSync(path.join(dir, 'example.ts'), example);
    execFileSync(
      process.execPath,
      [
        path.join(root, 'node_modules/typescript/bin/tsc'),
        '--strict',
        '--types',
        'node',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        'example.ts',
      ],
      { cwd: dir, encoding: 'utf8' }
    );
    // Importing the compiled example defines a function; it must not contact Memcached.
    execFileSync(process.execPath, ['example.js'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(
      JSON.parse(readFileSync(path.join(installed, 'package.json'))).name,
      '@zeruxjs/cache-memcache'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
