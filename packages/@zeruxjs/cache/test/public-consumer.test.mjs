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
test('packed public cache manager declarations and README example compile', () => {
  /** Absolute package root used to pack the public distribution. */
  const pkg = fileURLToPath(new URL('..', import.meta.url));
  /** Repository root supplying compiler and development dependencies. */
  const root = path.resolve(pkg, '../../..');
  /** Owned temporary consumer removed in finally, including npm cache files. */
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cache-public-'));
  try {
    /** npm archive metadata, obtained without running lifecycle scripts. */
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
    /** Archive descriptor supporting npm array and object output shapes. */
    const info = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
    /** Temporary scoped-package directory for the isolated consumer. */
    const scope = path.join(dir, 'node_modules', '@zeruxjs');
    /** Extracted cache package used instead of its workspace symlink. */
    const installed = path.join(scope, 'cache');
    mkdirSync(installed, { recursive: true });
    execFileSync('tar', [
      '-xzf',
      path.join(dir, info.filename),
      '-C',
      installed,
      '--strip-components=1',
    ]);
    // Link development dependencies without replacing the packed cache under test.
    for (const name of readdirSync(path.join(root, 'node_modules'))) {
      if (!['.bin', '@zeruxjs'].includes(name)) {
        symlinkSync(
          path.join(root, 'node_modules', name),
          path.join(dir, 'node_modules', name)
        );
      }
    }
    // Link other scoped dependencies while preserving the extracted public package.
    for (const name of readdirSync(
      path.join(root, 'node_modules', '@zeruxjs')
    )) {
      if (name !== 'cache') {
        symlinkSync(
          path.join(root, 'node_modules', '@zeruxjs', name),
          path.join(scope, name)
        );
      }
    }
    writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    /** Authored scoped-manager example compiled against the packed declarations. */
    const example = readFileSync(path.join(pkg, 'README.md'), 'utf8')
      .split('## Scoped managers')[1]
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
    // Importing the compiled example defines a function; it must not contact any provider.
    execFileSync(process.execPath, ['example.js'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(
      JSON.parse(readFileSync(path.join(installed, 'package.json'))).name,
      '@zeruxjs/cache'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
