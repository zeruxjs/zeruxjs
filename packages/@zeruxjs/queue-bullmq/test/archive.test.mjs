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
/** Promise-based argument-array process helper; no shell interpolation or app startup. */
const exec = promisify(execFile);
/** Test-local resolver for the already installed TypeScript compiler. */
const require = createRequire(import.meta.url);
test('real archive contains every public JS/declaration subpath and licenses; authored example compiles', async () => {
  /** Owned synthetic archive/consumer directory removed recursively in finally. */
  const temp = await mkdtemp(join(tmpdir(), 'zx-bullmq-archive-'));
  /** Owning package directory, not an operator application. */
  const packageRoot = resolve(import.meta.dirname, '..');
  /** Repository root used only to link installed test dependencies. */
  const workspace = resolve(packageRoot, '../../..');
  try {
    /** Local npm pack report produced without publishing or remote installation. */
    const report = JSON.parse(
      (
        await exec('npm', ['pack', '--json', '--pack-destination', temp], {
          cwd: packageRoot,
          env: { ...process.env, npm_config_cache: join(temp, 'cache') },
        })
      ).stdout
    );
    /** Single archive receipt including its declared files and filename. */
    const packed = Array.isArray(report) ? report[0] : Object.values(report)[0];
    /** Owned extracted package under the isolated consumer node_modules. */
    const dest = join(temp, 'node_modules/@zeruxjs/queue-bullmq');
    await mkdir(dest, { recursive: true });
    await exec('tar', [
      '-xzf',
      join(temp, packed.filename),
      '--strip-components=1',
      '-C',
      dest,
    ]);
    /** Packed public manifest used to verify exports and one-way dependencies. */
    const metadata = JSON.parse(
      await readFile(join(dest, 'package.json'), 'utf8')
    );
    assert.equal(metadata.version, '0.0.4');
    assert.equal(metadata.dependencies['@zeruxjs/queue'], undefined);
    // Exercise only the finite synthetic invalid cases, archive targets or fixed depth bound.
    for (const target of Object.values(metadata.exports)) {
      await access(join(dest, target.default));
      await access(join(dest, target.types));
    }
    // Exercise only the finite synthetic invalid cases, archive targets or fixed depth bound.
    for (const license of ['LICENSE-MIT', 'LICENSE-APACHE']) {
      await access(join(dest, license));
    }
    assert.ok(
      packed.files.every(
        (file) =>
          !file.path.startsWith('src/') && !file.path.startsWith('test/')
      )
    );
    await symlink(
      join(workspace, 'node_modules/@zeruxjs/cache-redis'),
      join(temp, 'node_modules/@zeruxjs/cache-redis'),
      'dir'
    );
    await symlink(
      join(workspace, 'node_modules/@types'),
      join(temp, 'node_modules/@types'),
      'dir'
    );
    await writeFile(join(temp, 'package.json'), '{"type":"module"}');
    /** README public-import example compiled as a standalone isolated consumer. */
    const example = (await readFile(join(packageRoot, 'README.md'), 'utf8'))
      .split('## Bounded enqueue and shutdown diagnostics')[1]
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
      `import {createQueueService,QUEUE_JOB_LIMITS} from '@zeruxjs/queue-bullmq';const metadata=${JSON.stringify(metadata)};for(const subpath of Object.keys(metadata.exports)){const id='@zeruxjs/queue-bullmq'+(subpath==='.'?'':subpath.slice(1));if(!Object.keys(await import(id)).length)throw Error('empty export');}if(typeof createQueueService!=='function'||QUEUE_JOB_LIMITS.maxBulk!==256)throw Error('root contract');`
    );
    await exec(process.execPath, ['run.mjs'], { cwd: temp });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
