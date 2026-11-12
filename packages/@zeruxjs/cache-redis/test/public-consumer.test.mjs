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
test('packed public Redis cache declarations and README example compile', () => {
  /** Package root used to create the public archive. */
  const pkg = fileURLToPath(new URL('..', import.meta.url));
  /** Repository root supplying compiler/development dependencies. */
  const root = path.resolve(pkg, '../../..');
  /** Owned temporary consumer removed in finally. */
  const dir = mkdtempSync(path.join(os.tmpdir(), 'redis-public-'));
  try {
    /** Archive metadata obtained without lifecycle execution. */
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
    /** npm descriptor supporting both array and object metadata. */
    const info = Array.isArray(packed) ? packed[0] : Object.values(packed)[0];
    /** Temporary scoped dependency root. */
    const scope = path.join(dir, 'node_modules', '@zeruxjs');
    /** Extracted Redis package used instead of its workspace symlink. */
    const installed = path.join(scope, 'cache-redis');
    mkdirSync(installed, { recursive: true });
    execFileSync('tar', [
      '-xzf',
      path.join(dir, info.filename),
      '-C',
      installed,
      '--strip-components=1',
    ]);
    // Link development dependencies while excluding packed cache and explicit driver fixtures.
    for (const name of readdirSync(path.join(root, 'node_modules'))) {
      if (!['.bin', '@zeruxjs', 'redis', 'ioredis'].includes(name)) {
        symlinkSync(
          path.join(root, 'node_modules', name),
          path.join(dir, 'node_modules', name)
        );
      }
    }
    // Retain the extracted package while linking other scoped dependencies.
    for (const name of readdirSync(
      path.join(root, 'node_modules', '@zeruxjs')
    )) {
      if (name !== 'cache-redis') {
        symlinkSync(
          path.join(root, 'node_modules', '@zeruxjs', name),
          path.join(scope, name)
        );
      }
    }
    writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}');
    /** Authored borrowed-client example compiled without external SDK installation. */
    const example = readFileSync(path.join(pkg, 'README.md'), 'utf8')
      .split('## Scoped diagnostics')[1]
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
    // Importing the compiled example defines a function; it must not contact Redis.
    execFileSync(process.execPath, ['example.js'], {
      cwd: dir,
      encoding: 'utf8',
    });
    assert.equal(
      JSON.parse(readFileSync(path.join(installed, 'package.json'))).name,
      '@zeruxjs/cache-redis'
    );

    /** Byte-sensitive synthetic driver module fixture, preserved as authored. */
    const base = `const {EventEmitter}=require('node:events');class Client extends EventEmitter{constructor(...args){super();this.options=args.at(-1);this.closed=0;}async connect(){}async close(){this.closed++;}async quit(){this.closed++;}destroy(){}disconnect(){}async get(){return null;}async set(){return 'OK';}async del(){return 0;}async exists(){return 0;}async mGet(keys){return keys.map(()=>null);}async mSet(){}async mget(...keys){return keys.map(()=>null);}async mset(){}async incrBy(){return 1;}async decrBy(){return 0;}async incrby(){return 1;}async decrby(){return 0;}async expire(){return 1;}async scan(){return ['0',[]];}async *scanIterator(){}};`;
    // Install only the two fixed synthetic driver modules in the disposable consumer.
    for (const driver of ['redis', 'ioredis']) {
      /** Temporary explicit driver fixture directory; never loaded from an arbitrary disk scan. */
      const target = path.join(dir, 'node_modules', driver);
      mkdirSync(target);
      writeFileSync(
        path.join(target, 'package.json'),
        JSON.stringify({ name: driver, main: 'index.cjs' })
      );
      writeFileSync(
        path.join(target, 'index.cjs'),
        driver === 'redis'
          ? base +
              `exports.calls=[];exports.createClient=options=>{const client=new Client(options);exports.calls.push(client);return client;};`
          : base +
              `class IO extends Client{constructor(...args){super(...args);IO.calls.push(this);}}IO.calls=[];module.exports=IO;`
      );
    }
    writeFileSync(
      path.join(dir, 'settings.cjs'),
      `const assert=require('node:assert/strict'),{createCacheHelper}=require('@zeruxjs/cache-redis');(async()=>{const node=await createCacheHelper({commandTimeoutMs:10,connectTimeoutMs:20,maxPendingCommands:4,maxReconnectAttempts:2});const n=require('redis').calls[0];assert.equal(n.options.disableOfflineQueue,true);assert.equal(n.options.commandsQueueMaxLength,4);assert.equal(n.options.socket.connectTimeout,20);assert.equal(n.options.socket.reconnectStrategy(0),50);assert.equal(n.options.socket.reconnectStrategy(2),false);assert.equal(n.options.onOperation,undefined);await node.close();assert.equal(n.closed,1);const io=await createCacheHelper({driver:'ioredis',maxReconnectAttempts:2});const i=require('ioredis').calls[0];assert.equal(i.options.lazyConnect,true);assert.equal(i.options.enableOfflineQueue,false);assert.equal(i.options.autoResendUnfulfilledCommands,false);assert.equal(i.options.maxRetriesPerRequest,0);assert.equal(i.options.retryStrategy(1),50);assert.equal(i.options.retryStrategy(3),null);await io.close();assert.equal(i.closed,1);})().catch(e=>{console.error(e);process.exitCode=1;});`
    );
    execFileSync(process.execPath, ['settings.cjs'], {
      cwd: dir,
      encoding: 'utf8',
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
