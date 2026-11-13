import fileIO from '../../../scripts/file-io.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  rm,
  readFile,
  writeFile,
  mkdir,
  readdir,
  stat,
  symlink,
  unlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { verifyPassword } from '@zeruxjs/auth';
import { activeWatcherCount } from 'zlook';
import { configureWorkspace } from '../scripts/workspace-configure.mjs';
import { watchWorkspaceAssets } from '../scripts/workspace-watch.mjs';

test('operator configuration is validated, secret-free in receipts, private and create-only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'workspace-config-'));
  const password = 'Only-a-synthetic-operator-password';
  const input = { root, argv: [], readPassword: async () => password };
  try {
    assert.equal(
      (
        await configureWorkspace({
          ...input,
          argv: ['--dry-run'],
          readPassword() {
            throw Error('must not read');
          },
        })
      ).status,
      'dry-run'
    );
    assert.deepEqual(await readdir(root), []);
    await assert.rejects(
      configureWorkspace({
        ...input,
        argv: ['--password', 'never-accept-secret-flags'],
      }),
      /Unknown option/
    );
    await assert.rejects(
      configureWorkspace({
        ...input,
        argv: ['--origin', 'http://remote.invalid'],
      }),
      /origin/
    );
    await assert.rejects(
      configureWorkspace({ ...input, argv: ['--username', '../bad'] }),
      /identity/
    );
    const receipt = await configureWorkspace(input);
    assert.equal(receipt.status, 'written');
    assert.doesNotMatch(
      JSON.stringify(receipt),
      /scrypt:|synthetic-operator-password/
    );
    const file = join(root, '.env.local'),
      original = fileIO.readRegularFileSync(file, 65536).toString('utf8'),
      settings = parseEnv(original);
    assert.equal((await stat(file)).mode & 0o077, 0);
    assert.doesNotMatch(original, /Only-a-synthetic-operator-password/);
    assert.equal(Buffer.from(settings.WORKSPACE_KEY, 'base64url').length, 32);
    const previous = process.env.SECURITY_PASSWORD_SALT;
    try {
      process.env.SECURITY_PASSWORD_SALT = settings.SECURITY_PASSWORD_SALT;
      assert.equal(
        verifyPassword(password, settings.WORKSPACE_PASSWORD_HASH),
        true
      );
    } finally {
      if (previous === undefined) delete process.env.SECURITY_PASSWORD_SALT;
      else process.env.SECURITY_PASSWORD_SALT = previous;
    }
    await assert.rejects(
      configureWorkspace(input),
      (error) => error.code === 'EEXIST'
    );
    assert.equal(
      fileIO.readRegularFileSync(file, 65536).toString('utf8'),
      original
    );
    await unlink(file);
    const destination = join(root, 'retained');
    await writeFile(destination, 'retain');
    await symlink(destination, file);
    await assert.rejects(
      configureWorkspace(input),
      (error) => error.code === 'EEXIST'
    );
    assert.equal(await readFile(destination, 'utf8'), 'retain');
    assert.deepEqual(
      (await readdir(root)).filter((name) =>
        name.startsWith('.workspace-config-')
      ),
      []
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test(
  'asset watcher handles changes/removal, preserves prior output on failure, excludes output and drains',
  { timeout: 10000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'workspace-watch-')),
      baseline = activeWatcherCount();
    for (const directory of ['client', 'scripts', 'public'])
      await mkdir(join(root, directory), { recursive: true });
    const source = join(root, 'client/workspace.ts'),
      output = join(root, 'public/workspace-client.js');
    await writeFile(source, 'first');
    let count = 0;
    const errors = [];
    const build = async () => {
      count++;
      const text = await readFile(source, 'utf8').catch((error) => {
        if (error.code === 'ENOENT') return 'removed';
        throw error;
      });
      if (text === 'bad') throw Error('synthetic dependency failure');
      await writeFile(output, text);
    };
    const controller = new AbortController();
    let owner;
    try {
      owner = await watchWorkspaceAssets({
        root,
        build,
        signal: controller.signal,
        onError: (message) => errors.push(message),
      });
      assert.equal(await readFile(output, 'utf8'), 'first');
      await writeFile(source, 'second');
      await owner.flush();
      assert.equal(await readFile(output, 'utf8'), 'second');
      await writeFile(source, 'bad');
      await owner.flush();
      assert.equal(await readFile(output, 'utf8'), 'second');
      assert.ok(
        errors.some((message) => message.includes('previous output retained'))
      );
      await rm(source);
      await owner.flush();
      assert.equal(await readFile(output, 'utf8'), 'removed');
      const before = count;
      await writeFile(output, 'generated');
      await owner.flush();
      assert.equal(count, before);
      controller.abort();
      await owner.close();
      assert.equal(activeWatcherCount(), baseline);
    } finally {
      await owner?.close();
      await rm(root, { recursive: true, force: true });
    }
  }
);
