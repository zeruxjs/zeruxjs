import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  symlinkSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
test('packed browser analytics imports without DOM/Node globals and public example types with no Node ambient types', () => {
  /** Actual package root used only for local archive/export verification. */
  const pkg = fileURLToPath(new URL('..', import.meta.url));
  /** Repository root supplying installed test compiler inputs, not operator runtime data. */
  const root = path.resolve(pkg, '../../..');
  /** Owned isolated packed-consumer directory removed in finally. */
  const dir = mkdtempSync(path.join(os.tmpdir(), 'performance-public-'));
  try {
    /** Local npm pack JSON result with no installation or remote fetch. */
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
    /** Normalized local archive receipt, or native fixture response metadata. */
    const info = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
    /** Owned extracted package path used for actual public imports/type checking. */
    const installed = path.join(dir, 'node_modules/@zeruxjs/performance');
    mkdirSync(installed, { recursive: true });
    execFileSync('tar', [
      '-xzf',
      path.join(dir, info.filename),
      '-C',
      installed,
      '--strip-components=1',
    ]);
    writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    writeFileSync(
      path.join(dir, 'example.ts'),
      readFileSync(path.join(pkg, 'examples/browser.ts'), 'utf8')
    );
    writeFileSync(
      path.join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          strict: true,
          noEmit: true,
          target: 'ES2022',
          module: 'ES2022',
          moduleResolution: 'Bundler',
          types: [],
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
        },
        files: ['example.ts'],
      })
    );
    execFileSync(
      process.execPath,
      [
        path.join(root, 'node_modules/typescript/bin/tsc'),
        '-p',
        'tsconfig.json',
      ],
      { cwd: dir, encoding: 'utf8' }
    );
    /** Explicit browser-compiled dependency graph checked for forbidden Node/provider imports. */
    const files = [
      'analytics.js',
      'rum.js',
      'timing.js',
      'types.js',
      'utils/webVitals.js',
    ];
    // Exercise only the fixed synthetic vocabulary/workload or inspected local package files.
    for (const file of files) {
      /** Owned synthetic response stream or emitted JavaScript being inspected, never untrusted executable input. */
      const source = readFileSync(
        path.join(installed, 'dist/browser', file),
        'utf8'
      );
      assert.doesNotMatch(
        source,
        /\b(?:require|Buffer|process)\b|node:|from ['"](?:lighthouse|web-vitals)['"]/
      );
    }
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "delete globalThis.window;delete globalThis.document;const api=await import('@zeruxjs/performance/analytics');if(typeof api.createBrowserPerformanceAnalytics!=='function')throw Error('missing');",
      ],
      { cwd: dir, encoding: 'utf8' }
    );
    execFileSync(
      process.execPath,
      [
        '-e',
        "const api=require('@zeruxjs/performance/analytics');if(typeof api.createServerPerformanceAdapter!=='function')throw Error('missing');",
      ],
      { cwd: dir, encoding: 'utf8' }
    );
    assert.ok(info.files.some((f) => f.path === 'examples/browser.ts'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
