import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  rm,
  access,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
/** Argument-array subprocess helper; no shell interpolation or dependency installation. */
const exec = promisify(execFile);
/** Test-local resolver for the installed compiler. */
const require = createRequire(import.meta.url);
test('packed basic/worker public exports and example compile and close without contacting a server', async () => {
  /** Owned isolated package archive/consumer directory removed in finally. */
  const temp = await mkdtemp(join(tmpdir(), 'zx-memcacheq-worker-'));
  /** Owning package root used for local pack and authored example. */
  const packageRoot = resolve(import.meta.dirname, '..');
  /** Repository root used only to link already installed dependencies. */
  const workspace = resolve(packageRoot, '../../..');
  try {
    /** Local npm pack JSON receipt; nothing is published. */
    const report: unknown = JSON.parse(
      (
        await exec('npm', ['pack', '--json', '--pack-destination', temp], {
          cwd: packageRoot,
          env: { ...process.env, npm_config_cache: join(temp, 'cache') },
        })
      ).stdout
    );
    assert.ok(report && typeof report === 'object');
    /** npm versions return an array or a filename-keyed object; validate the selected receipt. */
    const packed: unknown = Object.values(report)[0];
    assert.ok(
      packed &&
        typeof packed === 'object' &&
        'filename' in packed &&
        typeof packed.filename === 'string'
    );
    assert.ok('files' in packed && Array.isArray(packed.files));
    /** Owned isolated extracted consumer package path. */
    const dest = join(temp, 'node_modules/@zeruxjs/queue-memcacheq');
    await mkdir(dest, { recursive: true });
    await exec('tar', [
      '-xzf',
      join(temp, packed.filename),
      '--strip-components=1',
      '-C',
      dest,
    ]);
    await symlink(
      join(workspace, 'node_modules/@zeruxjs/cache-memcache'),
      join(temp, 'node_modules/@zeruxjs/cache-memcache'),
      'dir'
    );
    await symlink(
      join(workspace, 'node_modules/@types'),
      join(temp, 'node_modules/@types'),
      'dir'
    );
    await writeFile(join(temp, 'package.json'), '{"type":"module"}');
    /** Packed manifest used to verify all public exports/types/licenses. */
    const metadata: unknown = JSON.parse(
      await readFile(join(dest, 'package.json'), 'utf8')
    );
    assert.ok(
      metadata &&
        typeof metadata === 'object' &&
        'version' in metadata &&
        'exports' in metadata
    );
    assert.equal(metadata.version, '0.0.4');
    assert.ok(metadata.exports && typeof metadata.exports === 'object');
    // Process only finite fixture cases/handles; no live broker acceptance is inferred.
    for (const target of Object.values(metadata.exports)) {
      assert.ok(
        target &&
          typeof target === 'object' &&
          'types' in target &&
          typeof target.types === 'string'
      );
      assert.ok('default' in target && typeof target.default === 'string');
      await access(join(dest, target.types));
      await access(join(dest, target.default));
    }
    // Process only finite fixture cases/handles; no live broker acceptance is inferred.
    for (const license of ['LICENSE-MIT', 'LICENSE-APACHE']) {
      await access(join(dest, license));
    }
    assert.ok(
      packed.files.every((f: unknown) => {
        assert.ok(
          f &&
            typeof f === 'object' &&
            'path' in f &&
            typeof f.path === 'string'
        );
        return !f.path.startsWith('src/') && !f.path.startsWith('test/');
      })
    );
    /** README public worker example compiled alongside the existing basic imports. */
    const exampleMatch = (
      await readFile(join(packageRoot, 'README.md'), 'utf8')
    )
      .split('## Opt-in polling worker')[1]
      .match(/```ts\n([\s\S]*?)```/);
    assert.ok(exampleMatch);
    /** Extracted public snippet is compiled only in the owned temporary consumer. */
    const example = exampleMatch[1];
    await writeFile(
      join(temp, 'example.ts'),
      example +
        `\nimport {createMemcacheQ,type MemcacheQMessage} from '@zeruxjs/queue-memcacheq';const client=createMemcacheQ();const shape:MemcacheQMessage={name:'send',data:{}};client.close();\n`
    );
    await exec(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
        '--strict',
        '--skipLibCheck',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--target',
        'ES2022',
        '--types',
        'node',
        '--noEmit',
        'example.ts',
      ],
      { cwd: temp }
    );
    await writeFile(
      join(temp, 'run.mjs'),
      `import {createMemcacheQ,createMemcacheQWorker} from '@zeruxjs/queue-memcacheq';import {createMemcacheQWorker as workerEntry} from '@zeruxjs/queue-memcacheq/worker';if(createMemcacheQWorker!==workerEntry)throw Error('exports');const basic=createMemcacheQ();basic.close();await basic.whenClosed();const signal=new AbortController();signal.abort();const worker=workerEntry({connection:{serverMaxBytes:8192},queues:[{name:'jobs',handler:async()=>{}}],signal:signal.signal});await worker.close();await worker.closed;if(worker.status().activeSockets||worker.status().pendingTimers||worker.status().state!=='closed')throw Error('cleanup');`
    );
    await exec(process.execPath, ['run.mjs'], { cwd: temp });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
