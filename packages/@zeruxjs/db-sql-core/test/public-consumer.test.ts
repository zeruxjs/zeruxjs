import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  symlinkSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
test('packed public compiler declarations and README example work without source aliases', () => {
  /** Package root used to create the public archive. */
  const pkg = fileURLToPath(new URL('..', import.meta.url));
  /** Repository root supplying compiler/runtime dependencies. */
  const root = path.resolve(pkg, '../../..');
  /** Owned temporary packed consumer removed in finally. */
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sql-core-public-'));
  try {
    /** npm metadata obtained without lifecycle scripts. */
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
    /** Extracted public SQL-core package without workspace source aliases. */
    const installed = path.join(scope, 'db-sql-core');
    mkdirSync(installed, { recursive: true });
    execFileSync('tar', [
      '-xzf',
      path.join(dir, info.filename),
      '-C',
      installed,
      '--strip-components=1',
    ]);
    // Link development dependencies without replacing the packed compiler.
    for (const name of readdirSync(path.join(root, 'node_modules'))) {
      if (!['.bin', '@zeruxjs'].includes(name)) {
        symlinkSync(
          path.join(root, 'node_modules', name),
          path.join(dir, 'node_modules', name)
        );
      }
    }
    // Retain the extracted SQL-core package while linking its public database contract.
    for (const name of readdirSync(
      path.join(root, 'node_modules', '@zeruxjs')
    )) {
      if (name !== 'db-sql-core') {
        symlinkSync(
          path.join(root, 'node_modules', '@zeruxjs', name),
          path.join(scope, name)
        );
      }
    }
    writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    /** Authored direct compiler example compiled and executed without a database. */
    const exampleMatch = readFileSync(
      path.join(pkg, 'README.md'),
      'utf8'
    ).match(/```ts\n([\s\S]*?)```/);
    if (!exampleMatch?.[1]) {
      throw new Error('README TypeScript example is missing');
    }
    /** Nonempty TypeScript example copied into the isolated consumer project. */
    const example = exampleMatch[1];
    writeFileSync(path.join(dir, 'example.ts'), example);
    execFileSync(
      process.execPath,
      [
        path.join(root, 'node_modules/typescript/bin/tsc'),
        '--strict',
        '--types',
        'node',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--target',
        'ES2022',
        'example.ts',
      ],
      { cwd: dir, encoding: 'utf8' }
    );
    assert.match(
      execFileSync(process.execPath, ['example.js'], {
        cwd: dir,
        encoding: 'utf8',
      }),
      /\$3/
    );
    assert.equal(existsSync(path.join(installed, 'src')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
