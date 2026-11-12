import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  symlink,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
/** Promisified child-process primitive; all commands use argument arrays, never shell interpolation. */
const exec = promisify(execFile);
/** Package-root resolver for installed test dependencies; never loads arbitrary packages discovered on disk. */
const require = createRequire(import.meta.url);
test('packed exports and README example compile and run with installed SDK dependencies', async () => {
  /** Owned isolated packed-consumer directory, removed in finally. */
  const temporary = await mkdtemp(join(tmpdir(), 'zx-files-consumer-'));
  /** Resolved source package used for local pack and README extraction. */
  const packageRoot = resolve(import.meta.dirname, '..');
  /** Repository root supplying installed test dependencies through explicit symlinks. */
  const workspace = resolve(packageRoot, '../../..');
  try {
    /** JSON result from local npm pack into the owned temporary directory. */
    const packed = JSON.parse(
      (
        await exec('npm', ['pack', '--json', '--pack-destination', temporary], {
          cwd: packageRoot,
          env: {
            ...process.env,
            npm_config_cache: join(temporary, 'npm-cache'),
          },
        })
      ).stdout
    );
    /** Normalized npm pack record supporting workspace-keyed and array formats. */
    const metadata = Array.isArray(packed)
      ? packed[0]
      : Object.values(packed)[0];
    /** Private extracted consumer package location under the owned temporary root. */
    const destination = join(temporary, 'node_modules/@zeruxjs/files');
    await mkdir(destination, { recursive: true });
    await exec('tar', [
      '-xzf',
      join(temporary, metadata.filename),
      '--strip-components=1',
      '-C',
      destination,
    ]);
    // Link only the declared installed SDK/type dependency scopes into the owned consumer fixture.
    for (const scope of ['@aws-sdk', '@smithy', '@types']) {
      await symlink(
        join(workspace, 'node_modules', scope),
        join(temporary, 'node_modules', scope),
        'dir'
      );
    }
    /** Authored package documentation read as inert text for public-import examples. */
    const readme = await readFile(join(packageRoot, 'README.md'), 'utf8');
    /** Roles Anywhere TypeScript snippet extracted without invoking a credential helper. */
    const example = readme
      .split('## IAM Roles Anywhere and credential diagnostics')[1]
      .match(/```ts\n([\s\S]*?)```/)[1];
    await writeFile(join(temporary, 'example.ts'), example);
    /** Resumable TypeScript snippet extracted for strict compile-only qualification. */
    const resumable = readme
      .split('## Resumable uploads')[1]
      .match(/```ts\n([\s\S]*?)```/)[1];
    await writeFile(join(temporary, 'resumable.ts'), resumable);
    await writeFile(
      join(temporary, 'package.json'),
      JSON.stringify({ type: 'module' })
    );
    await exec(
      process.execPath,
      [
        require.resolve('typescript/bin/tsc'),
        '--noEmit',
        '--strict',
        '--target',
        'ES2022',
        '--module',
        'NodeNext',
        '--moduleResolution',
        'NodeNext',
        '--skipLibCheck',
        'example.ts',
        'resumable.ts',
      ],
      { cwd: temporary }
    );
    await writeFile(
      join(temporary, 'consumer.mjs'),
      `import {createS3Storage, monitorAwsCredentials, createResumableUploads} from '@zeruxjs/files';\nimport {createFilesClient} from '@zeruxjs/files/client';\nconst driver=createS3Storage({rolesAnywhere:{profile:'trusted'}});\nif(driver.capabilities.createOnlyStream!==false||typeof createResumableUploads!=='function'||typeof monitorAwsCredentials!=='function'||typeof createFilesClient!=='function')throw new Error('public contract');\nawait driver.close();`
    );
    await exec(process.execPath, ['consumer.mjs'], { cwd: temporary });
    /** Packed package JSON inspected for unchanged identity/export-map contracts. */
    const manifest = JSON.parse(
      await readFile(join(destination, 'package.json'), 'utf8')
    );
    assert.equal(manifest.version, '0.0.4');
    assert.deepEqual(Object.keys(manifest.exports), ['.', './client']);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
