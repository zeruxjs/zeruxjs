/** Node test registry; fixtures own all resources explicitly. */
const { test } = require('node:test');
/** Strict assertions; no test outcome is inferred from successful compilation. */
const assert = require('node:assert/strict');
/** Filesystem utilities restricted to disposable fixture roots. */
const fs = require('node:fs');
/** Filesystem path construction without shell interpolation. */
const path = require('node:path');
/** Temporary-directory discovery; no operator database path is used. */
const os = require('node:os');
/** Structured subprocess invocation, never interpolated shell commands. */
const { execFileSync } = require('node:child_process');
test('packed declaration consumer and README example use installed public exports', () => {
  /** Package root used to pack the public distribution. */
  const pkg = path.resolve(__dirname, '..');
  /** Repository root supplying compiler and optional SQLite connector fixtures. */
  const root = path.resolve(pkg, '../../..');
  /** Owned temporary packed consumer removed in finally. */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-public-'));
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
    /** Extracted public db package used instead of a workspace source import. */
    const installed = path.join(scope, 'db');
    fs.mkdirSync(installed, { recursive: true });
    execFileSync('tar', [
      '-xzf',
      path.join(dir, info.filename),
      '-C',
      installed,
      '--strip-components=1',
    ]);
    // Link compiler/development dependencies without replacing the packed public package.
    for (const name of fs.readdirSync(path.join(root, 'node_modules'))) {
      if (name !== '.bin' && name !== '@zeruxjs') {
        fs.symlinkSync(
          path.join(root, 'node_modules', name),
          path.join(dir, 'node_modules', name)
        );
      }
    }
    // Keep the extracted db package while linking required optional connectors.
    for (const name of fs.readdirSync(
      path.join(root, 'node_modules', '@zeruxjs')
    )) {
      if (name !== 'db') {
        fs.symlinkSync(
          path.join(root, 'node_modules', '@zeruxjs', name),
          path.join(scope, name)
        );
      }
    }
    fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(
      path.join(dir, 'consumer.ts'),
      `import {createDatabaseManager,createKeysetPage, type DatabaseQueryOptions, type DatabaseQueryMetric} from '@zeruxjs/db';
const options:DatabaseQueryOptions={timeoutMs:100,require:['returning']};
const manager=await createDatabaseManager({connections:[{name:'Test',slug:'test',connector:'@zeruxjs/db-sqlite',options:{filename:':memory:',driver:'node'}}],execution:{onMetric(metric:DatabaseQueryMetric){const count:number|undefined=metric.count;}}});
const page=createKeysetPage({table:'items',order:[{column:'id',direction:'asc'}],uniqueKey:'id',limit:1});
await manager.select(page.operation,options);await manager.disconnect();
`
    );
    /** Authored public pin example compiled against installed declarations. */
    const transactionExample = fs
      .readFileSync(path.join(pkg, 'README.md'), 'utf8')
      .split('## Pinned transaction extension')[1]
      .match(/```ts\n([\s\S]*?)```/)[1];
    fs.appendFileSync(path.join(dir, 'consumer.ts'), transactionExample);
    execFileSync(
      process.execPath,
      [
        path.join(root, 'node_modules/typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--types',
        'node',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--target',
        'ES2022',
        path.join(dir, 'consumer.ts'),
      ],
      { cwd: dir, encoding: 'utf8' }
    );
    /** Authored keyset example section; no guessed APIs are substituted. */
    const readme = fs
      .readFileSync(path.join(pkg, 'README.md'), 'utf8')
      .split('## Keyset example using public imports')[1];
    /** Public keyset example run against an in-memory SQLite database. */
    const example = readme.match(/```ts\n([\s\S]*?)```/)[1];
    /** Existing TypeScript compiler used only to emit the disposable example. */
    const ts = require(path.join(root, 'node_modules/typescript'));
    fs.writeFileSync(
      path.join(dir, 'example.mjs'),
      ts.transpileModule(example, {
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText
    );
    execFileSync(process.execPath, [path.join(dir, 'example.mjs')], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.ok(fs.existsSync(path.join(installed, 'dist/index.d.ts')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
