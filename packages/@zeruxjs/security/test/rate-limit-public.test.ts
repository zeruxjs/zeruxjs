import { createRequire } from 'node:module';
/** CommonJS bridge retained for the package's existing require-based fixtures. */
const require = createRequire(import.meta.url);
/** Native test registration API; callbacks own their synthetic resource lifetimes. */
const test: typeof import('node:test') = require('node:test');
/** Native strict assertions; failures must remain visible after fixture cleanup. */
const assert: typeof import('node:assert/strict') = require('node:assert/strict');
/** Public native/library fixture APIs; tests retain explicit ownership of every acquired resource. */
const {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
}: typeof import('node:fs') = require('node:fs');
/** Public native/library fixture APIs; tests retain explicit ownership of every acquired resource. */
const {
  execFileSync,
}: typeof import('node:child_process') = require('node:child_process');
/** Native temporary-directory discovery; no operator application paths are inspected. */
const os: typeof import('node:os') = require('node:os');
/** Native path helpers for fixture-owned directories, never caller-selected shell interpolation. */
const path: typeof import('node:path') = require('node:path');
test('packed security/Redis declarations compile the application-scoped admission example', () => {
  /** Real package root used only to read/pack public fixture inputs. */
  const pkg = path.resolve(import.meta.dirname, '..');
  /** Owned temporary installed-consumer root, removed in finally. */
  const root = path.resolve(pkg, '../../..');
  /** Owned temporary archive/consumer directory removed recursively in finally. */
  const dir = mkdtempSync(path.join(os.tmpdir(), 'limiter-public-'));
  try {
    /** Owned temporary node_modules scope used for public declaration/import checks. */
    const scope = path.join(dir, 'node_modules', '@zeruxjs');
    mkdirSync(scope, { recursive: true });
    for (const name of ['security', 'cache-redis']) {
      /** Exact local package directory for shell-free npm archive preparation. */
      const cwd = path.join(root, 'packages', '@zeruxjs', name);
      /** Package archive metadata from an explicit no-script local fixture pack. */
      const packed: unknown = JSON.parse(
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
          { cwd, encoding: 'utf8' }
        )
      );
      /** Selected npm archive record supporting both current array/object JSON output shapes. */
      assert.ok(packed && typeof packed === 'object');
      /** Receipt must contain a filename before the owned archive can be extracted. */
      const info: unknown = Object.values(packed)[0];
      assert.ok(
        info &&
          typeof info === 'object' &&
          'filename' in info &&
          typeof info.filename === 'string'
      );
      /** Owned temporary installed package directory; source paths are deliberately absent. */
      const installed = path.join(scope, name);
      mkdirSync(installed);
      execFileSync('tar', [
        '-xzf',
        path.join(dir, info.filename),
        '-C',
        installed,
        '--strip-components=1',
      ]);
      assert.equal(
        JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'))
          .name,
        `@zeruxjs/${name}`
      );
    }
    for (const name of readdirSync(path.join(root, 'node_modules'))) {
      if (!['.bin', '@zeruxjs'].includes(name)) {
        symlinkSync(
          path.join(root, 'node_modules', name),
          path.join(dir, 'node_modules', name)
        );
      }
    }
    for (const name of readdirSync(
      path.join(root, 'node_modules', '@zeruxjs')
    )) {
      if (!['security', 'cache-redis'].includes(name)) {
        symlinkSync(
          path.join(root, 'node_modules', '@zeruxjs', name),
          path.join(scope, name)
        );
      }
    }
    writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    /** Exact authored public README example compiled in the isolated temporary installed consumer. */
    const sourceMatch = readFileSync(path.join(pkg, 'README.md'), 'utf8')
      .split('## Atomic endpoint rate limits')[1]
      .match(/```ts\n([\s\S]*?)```/);
    assert.ok(sourceMatch);
    /** Public authored example is compiled but never connects to Redis. */
    const source = sourceMatch[1];
    writeFileSync(path.join(dir, 'example.ts'), source);
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
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
