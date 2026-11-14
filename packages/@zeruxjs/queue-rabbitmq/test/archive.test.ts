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
/** Argument-array subprocess helper for local pack/compiler checks; no shell interpolation. */
const exec = promisify(execFile);
/** Test-local resolver for already installed TypeScript. */
const require = createRequire(import.meta.url);
test('packed worker/root declarations and authored example work through installed exports', async () => {
  /** Owned isolated archive/consumer directory always removed in finally. */
  const temp = await mkdtemp(join(tmpdir(), 'zx-rabbit-worker-'));
  /** Owning package root, never an operator application. */
  const packageRoot = resolve(import.meta.dirname, '..');
  /** Repository root used only to link installed test dependencies. */
  const workspace = resolve(packageRoot, '../../..');
  try {
    /** Local npm pack report; nothing is published or installed remotely. */
    const report = JSON.parse(
      (
        await exec('npm', ['pack', '--json', '--pack-destination', temp], {
          cwd: packageRoot,
          env: { ...process.env, npm_config_cache: join(temp, 'cache') },
        })
      ).stdout
    );
    /** One local archive receipt and finite file inventory. */
    const packed = Array.isArray(report) ? report[0] : Object.values(report)[0];
    /** Owned extracted consumer package directory. */
    const dest = join(temp, 'node_modules/@zeruxjs/queue-rabbitmq');
    await mkdir(dest, { recursive: true });
    await exec('tar', [
      '-xzf',
      join(temp, packed.filename),
      '--strip-components=1',
      '-C',
      dest,
    ]);
    await symlink(
      join(workspace, 'node_modules/amqplib'),
      join(temp, 'node_modules/amqplib'),
      'dir'
    );
    await symlink(
      join(workspace, 'node_modules/@types'),
      join(temp, 'node_modules/@types'),
      'dir'
    );
    await writeFile(join(temp, 'package.json'), '{"type":"module"}');
    /** Packed manifest checked for every public runtime/type export and license. */
    const metadata = JSON.parse(
      await readFile(join(dest, 'package.json'), 'utf8')
    );
    assert.equal(metadata.version, '0.0.4');
    // Inspect only finite synthetic outcomes/handles or the explicit polling ceiling.
    for (const target of Object.values(metadata.exports)) {
      await access(join(dest, target.types));
      await access(join(dest, target.default));
    }
    // Inspect only finite synthetic outcomes/handles or the explicit polling ceiling.
    for (const file of ['LICENSE-MIT', 'LICENSE-APACHE']) {
      await access(join(dest, file));
    }
    assert.ok(
      packed.files.every(
        (f) => !f.path.startsWith('src/') && !f.path.startsWith('test/')
      )
    );
    /** README public-import worker example compiled in the isolated consumer. */
    const example = (await readFile(join(packageRoot, 'README.md'), 'utf8'))
      .split('## Opt-in supervised worker service')[1]
      .match(/```ts\n([\s\S]*?)```/)[1];
    await writeFile(
      join(temp, 'example.ts'),
      example +
        `\nimport {createRabbitMQ,type RabbitMQOptions} from '@zeruxjs/queue-rabbitmq';export const legacy=(options:RabbitMQOptions)=>createRabbitMQ(options);\n`
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
      `import {EventEmitter} from 'node:events';import {createRabbitMQ,createRabbitMQWorker} from '@zeruxjs/queue-rabbitmq';import {createRabbitMQWorker as explicit} from '@zeruxjs/queue-rabbitmq/worker';if(typeof createRabbitMQ!=='function'||explicit!==createRabbitMQWorker)throw Error('exports');const resource=()=>Object.assign(new EventEmitter(),{async close(){},async assertQueue(){}});const producer=resource(),consumer=resource(),connection=Object.assign(resource(),{async createConfirmChannel(){return producer;},async createChannel(){return consumer;}});const service=await explicit({url:'amqp://localhost',queues:[{name:'jobs',type:'classic'}]},async()=>connection);await service.close();if(service.status().state!=='closed')throw Error('cleanup');`
    );
    await exec(process.execPath, ['run.mjs'], { cwd: temp });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
