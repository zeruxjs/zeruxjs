/** Node test registry for the disposable packed consumer. */
const test = require('node:test');
/** Strict assertions; compilation alone does not prove native behavior. */
const assert = require('node:assert/strict');
/** Filesystem utilities used only within the owned packed-consumer root. */
const {
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} = require('node:fs');
/** Structured subprocess execution without shell interpolation. */
const { execFileSync } = require('node:child_process');
/** Temporary root discovery without reading operator database state. */
const os = require('node:os');
/** Filesystem paths passed as structured subprocess arguments. */
const path = require('node:path');
test('packed exports compile the public README example; optional missing driver and owned initialization clean up', () => {
  /** Package root supplying public README/declarations. */
  const pkg = path.resolve(__dirname, '..');
  /** Repository root supplying the compiler and development dependencies. */
  const root = path.resolve(pkg, '../../..');
  /** Owned temporary consumer removed in finally. */
  const dir = mkdtempSync(path.join(os.tmpdir(), 'mongo-public-'));
  try {
    /** npm archive metadata obtained without lifecycle execution. */
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
    /** Extracted public connector used instead of its workspace source. */
    const installed = path.join(scope, 'db-mongo');
    mkdirSync(installed, { recursive: true });
    execFileSync('tar', [
      '-xzf',
      path.join(dir, info.filename),
      '-C',
      installed,
      '--strip-components=1',
    ]);
    // Link development dependencies while deliberately omitting the optional native driver.
    for (const name of readdirSync(path.join(root, 'node_modules'))) {
      if (!['.bin', '@zeruxjs', 'mongodb'].includes(name)) {
        symlinkSync(
          path.join(root, 'node_modules', name),
          path.join(dir, 'node_modules', name)
        );
      }
    }
    // Retain the extracted Mongo package while linking its public database contract.
    for (const name of readdirSync(
      path.join(root, 'node_modules', '@zeruxjs')
    )) {
      if (name !== 'db-mongo') {
        symlinkSync(
          path.join(root, 'node_modules', '@zeruxjs', name),
          path.join(scope, name)
        );
      }
    }
    writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    /** Authored public session example compiled without the optional native driver. */
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
    execFileSync(process.execPath, ['example.js'], {
      cwd: dir,
      encoding: 'utf8',
    });
    writeFileSync(
      path.join(dir, 'missing.cjs'),
      `const assert=require('node:assert/strict');const {createConnector}=require('@zeruxjs/db-mongo');assert.rejects(createConnector({uri:'mongodb://localhost/fixture'}),e=>e.details.code==='MISSING_MONGO_DRIVER').catch(e=>{console.error(e);process.exitCode=1;});`
    );
    execFileSync(process.execPath, ['missing.cjs'], {
      cwd: dir,
      encoding: 'utf8',
    });
    /** Explicit temporary mongodb fixture testing missing/owned startup paths. */
    const driver = path.join(dir, 'node_modules', 'mongodb');
    mkdirSync(driver);
    writeFileSync(
      path.join(driver, 'package.json'),
      '{"name":"mongodb","main":"index.cjs"}'
    );
    writeFileSync(
      path.join(driver, 'index.cjs'),
      `exports.events=[];exports.MongoClient=class{async connect(){exports.events.push('connect');throw Error('simulated connect failure');}async close(){exports.events.push('close');}db(){return {};}};`
    );
    writeFileSync(
      path.join(dir, 'owned.cjs'),
      `const assert=require('node:assert/strict'),driver=require('mongodb');const {createConnector}=require('@zeruxjs/db-mongo');(async()=>{await assert.rejects(createConnector({uri:'mongodb://localhost/fixture',transactions:true}),/simulated connect failure/);assert.deepEqual(driver.events,['connect','close']);const options={uri:'mongodb://localhost/fixture'};const db=await createConnector(options);assert.equal(options.client,undefined);await db.disconnect();await db.disconnect();assert.equal(driver.events.filter(e=>e==='close').length,2);})().catch(e=>{console.error(e);process.exitCode=1;});`
    );
    execFileSync(process.execPath, ['owned.cjs'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(
      JSON.parse(readFileSync(path.join(installed, 'package.json'))).name,
      '@zeruxjs/db-mongo'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
