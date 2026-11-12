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
test('packed adapter and policy exports compile through public declarations without opening connections', () => {
  /** Package root supplying the authored example. */
  const pkg = fileURLToPath(new URL('..', import.meta.url));
  /** Repository root supplying compiler and development dependencies. */
  const root = path.resolve(pkg, '../../..');
  /** Owned temporary consumer removed in finally. */
  const dir = mkdtempSync(path.join(os.tmpdir(), 'valkey-public-'));
  try {
    /** Temporary scope containing packed cache and Valkey packages. */
    const scope = path.join(dir, 'node_modules', '@zeruxjs');
    mkdirSync(scope, { recursive: true });
    // Pack both public contracts so adapter compilation cannot accidentally use workspace source.
    for (const name of ['cache', 'cache-valkey']) {
      /** Archive metadata obtained without lifecycle scripts. */
      const packed = JSON.parse(
        execFileSync(
          'npm',
          [
            'pack',
            '--ignore-scripts',
            '--cache',
            path.join(dir, 'npm-cache'),
            '--pack-destination',
            dir,
            '--json',
          ],
          { cwd: path.join(root, 'packages/@zeruxjs', name), encoding: 'utf8' }
        )
      );
      /** npm pack descriptor supporting array/object result shapes. */
      const info = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
      /** Extracted public package used instead of its workspace source. */
      const installed = path.join(scope, name);
      mkdirSync(installed);
      execFileSync('tar', [
        '-xzf',
        path.join(dir, info.filename),
        '-C',
        installed,
        '--strip-components=1',
      ]);
      assert.ok(info.files.some((f) => f.path === 'README.md'));
    }
    // Link compiler/runtime dependencies without replacing the packed scoped packages.
    for (const name of readdirSync(path.join(root, 'node_modules'))) {
      if (!['.bin', '@zeruxjs'].includes(name)) {
        symlinkSync(
          path.join(root, 'node_modules', name),
          path.join(dir, 'node_modules', name)
        );
      }
    }
    writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    writeFileSync(
      path.join(dir, 'example.ts'),
      readFileSync(path.join(pkg, 'examples/scoped.ts'), 'utf8') +
        "\nimport {cachePolicy,cacheKey} from '@zeruxjs/cache/policy';\ncacheKey('safe',cachePolicy());\n"
    );
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
    execFileSync(process.execPath, ['example.js'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 5000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
