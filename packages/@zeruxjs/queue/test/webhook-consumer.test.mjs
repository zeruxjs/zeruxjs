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
/** Promisified fixed-argument subprocess helper; never shell interpolation. */
const exec = promisify(execFile);
/** Installed local dependency resolver; no arbitrary package discovery. */
const require = createRequire(import.meta.url);
test('packed webhook API and authored example use real installed public exports', async () => {
  /** Owned isolated consumer root, removed in finally. */
  const temp = await mkdtemp(join(tmpdir(), 'zx-webhook-consumer-'));
  /** Actual source package root used for local archive/export checks. */
  const packageRoot = resolve(import.meta.dirname, '..');
  /** Repository root used only for installed local consumer dependencies. */
  const workspace = resolve(packageRoot, '../../..');
  try {
    /** Observed bounded coverage-labelled synthetic report. */
    const report = JSON.parse(
      (
        await exec('npm', ['pack', '--json', '--pack-destination', temp], {
          cwd: packageRoot,
          env: { ...process.env, npm_config_cache: join(temp, 'cache') },
        })
      ).stdout
    );
    /** Normalized local npm pack result, not a dependency installation. */
    const packed = Array.isArray(report) ? report[0] : Object.values(report)[0];
    /** Owned local archive extraction destination. */
    const dest = join(temp, 'node_modules/@zeruxjs/queue');
    await mkdir(dest, { recursive: true });
    await exec('tar', [
      '-xzf',
      join(temp, packed.filename),
      '--strip-components=1',
      '-C',
      dest,
    ]);
    // Exercise only the fixed synthetic records, allowlisted operations or owned cleanup handles.
    for (const name of ['queue-bullmq', 'db', 'security']) {
      await symlink(
        join(workspace, 'node_modules/@zeruxjs', name),
        join(temp, 'node_modules/@zeruxjs', name),
        'dir'
      );
    }
    await symlink(
      join(workspace, 'node_modules/@types'),
      join(temp, 'node_modules/@types'),
      'dir'
    );
    await writeFile(join(temp, 'package.json'), '{"type":"module"}');
    /** Local archive/manifest metadata checked against real public exports. */
    const metadata = JSON.parse(
      await readFile(join(dest, 'package.json'), 'utf8')
    );
    assert.equal(metadata.version, '0.0.4');
    await access(join(dest, metadata.exports['./webhooks'].default));
    await access(join(dest, metadata.exports['./webhooks'].types));
    /** Authored inert consumer source compiled in isolation, never remotely fetched. */
    const example = (await readFile(join(packageRoot, 'README.md'), 'utf8'))
      .split('## Durable opt-in webhooks')[1]
      .match(/```ts\n([\s\S]*?)```/)[1];
    await writeFile(join(temp, 'example.ts'), example);
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
      `import {createWebhookWorkflow,signWebhook,verifyWebhook} from '@zeruxjs/queue/webhooks';import {createQueueService} from '@zeruxjs/queue';const keys={current:{id:'key',key:new Uint8Array(32).fill(1)}};const packet={tenant:'tenant',destination:'partner',deliveryId:'delivery',timestamp:1000,body:'{}'};const signed=signWebhook(packet,keys);if(!verifyWebhook({...packet,timestamp:'1000',signature:signed['x-zerux-webhook-signature']},keys,{now:1000000})||typeof createWebhookWorkflow!=='function'||typeof createQueueService!=='function')throw Error('public API');`
    );
    await exec(process.execPath, ['run.mjs'], { cwd: temp });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
