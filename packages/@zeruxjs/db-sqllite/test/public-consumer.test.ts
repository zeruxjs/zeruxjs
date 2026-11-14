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
test('packed sync API declarations and disposable README example use public imports', () => {
  /** Absolute package root used solely for local archive verification. */
  const pkg = fileURLToPath(new URL('..', import.meta.url));
  /** Workspace root used to borrow installed build dependencies without network installation. */
  const root = path.resolve(pkg, '../../..');
  /** Exclusive disposable fixture directory; never an operator database path. */
  const dir = mkdtempSync(path.join(os.tmpdir(), 'sqlite-public-'));
  try {
    /** npm archive metadata from the existing built package; no lifecycle script runs. */
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
    /** Normalized local npm pack record identifying the owned archive. */
    const info = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
    /** Temporary consumer namespace for the packed public package. */
    const scope = path.join(dir, 'node_modules', '@zeruxjs');
    /** Extracted package root used to verify only shipped files/public imports. */
    const installed = path.join(scope, 'db-sqlite');
    mkdirSync(installed, { recursive: true });
    execFileSync('tar', [
      '-xzf',
      path.join(dir, info.filename),
      '-C',
      installed,
      '--strip-components=1',
    ]);
    // Borrow installed tooling without replacing the packed public SQLite package.
    for (const name of readdirSync(path.join(root, 'node_modules'))) {
      if (!['.bin', '@zeruxjs'].includes(name)) {
        symlinkSync(
          path.join(root, 'node_modules', name),
          path.join(dir, 'node_modules', name)
        );
      }
    }
    // Keep the extracted SQLite package while linking its public workspace dependencies.
    for (const name of readdirSync(
      path.join(root, 'node_modules', '@zeruxjs')
    )) {
      if (name !== 'db-sqlite') {
        symlinkSync(
          path.join(root, 'node_modules', '@zeruxjs', name),
          path.join(scope, name)
        );
      }
    }
    writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    /** Authored disposable README example compiled and executed as a consumer. */
    /** Authored README section containing the synchronous transaction example. */
    const section = readFileSync(path.join(pkg, 'README.md'), 'utf8').split(
      '## Synchronous transactions'
    )[1];
    /** First fenced TypeScript example extracted from the documented section. */
    const exampleMatch = section?.match(/```ts\n([\s\S]*?)```/);
    if (!exampleMatch?.[1]) {
      throw new Error('SQLite README TypeScript example is missing');
    }
    /** Nonempty example source written to the isolated consumer project. */
    const example = exampleMatch[1];
    writeFileSync(
      path.join(dir, 'example.ts'),
      example +
        `\nfunction compileOnly(db:SqliteConnector){\n// @ts-expect-error async callbacks cannot cross synchronous transaction scope\ndb.transactionSync(async()=>{});\n}\n`
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
    });
    /** Fixed trusted child-process fixture proving package import does not eagerly require Node SQLite. */
    const script = `const Module=require('node:module');const original=Module._load;Module._load=function(name,...args){if(name==='node:sqlite')throw Error('eager native import');return original.call(this,name,...args);};const api=require(process.argv[1]);if(typeof api.createConnector!=='function')throw Error('missing factory');`;
    execFileSync(
      process.execPath,
      ['-e', script, path.join(installed, 'dist/index.js')],
      { cwd: dir, encoding: 'utf8' }
    );
    assert.equal(
      JSON.parse(readFileSync(path.join(installed, 'package.json'), 'utf8'))
        .name,
      '@zeruxjs/db-sqlite'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
