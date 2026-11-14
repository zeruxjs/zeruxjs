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
test('packed public MySQL transaction declarations and README example compile', () => {
  /** Package root supplying the public archive and authored example. */
  const pkg = fileURLToPath(new URL('..', import.meta.url));
  /** Repository root supplying compiler/development dependencies. */
  const root = path.resolve(pkg, '../../..');
  /** Owned temporary packed consumer removed in finally. */
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mysql-public-'));
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
    /** Archive descriptor supporting npm array/object output. */
    const info = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
    /** Temporary scoped dependency directory. */
    const scope = path.join(dir, 'node_modules', '@zeruxjs');
    /** Extracted public MySQL package used instead of workspace source. */
    const installed = path.join(scope, 'db-mysql');
    mkdirSync(installed, { recursive: true });
    execFileSync('tar', [
      '-xzf',
      path.join(dir, info.filename),
      '-C',
      installed,
      '--strip-components=1',
    ]);
    // Link compiler/runtime dependencies without replacing the packed public adapter.
    for (const name of readdirSync(path.join(root, 'node_modules'))) {
      if (!['.bin', '@zeruxjs'].includes(name)) {
        symlinkSync(
          path.join(root, 'node_modules', name),
          path.join(dir, 'node_modules', name)
        );
      }
    }
    // Keep the extracted adapter while linking its public database/SQL-core contracts.
    for (const name of readdirSync(
      path.join(root, 'node_modules', '@zeruxjs')
    )) {
      if (name !== 'db-mysql') {
        symlinkSync(
          path.join(root, 'node_modules', '@zeruxjs', name),
          path.join(scope, name)
        );
      }
    }
    writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    /** Authored borrowed-pool example compiled without contacting MySQL. */
    const example = readFileSync(path.join(pkg, 'README.md'), 'utf8')
      .split('## Pinned transactions')[1]
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
    // Importing the compiled example defines a function; it must not contact MySQL.
    execFileSync(process.execPath, ['example.js'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(
      JSON.parse(readFileSync(path.join(installed, 'package.json'))).name,
      '@zeruxjs/db-mysql'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
