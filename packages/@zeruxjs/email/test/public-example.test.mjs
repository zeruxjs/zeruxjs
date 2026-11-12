import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, writeFile, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

test('public bounded mailer example compiles, sends, denies and preserves borrowed transport ownership', async (t) => {
  /** Package root containing the authored public-import example. */
  const pkg = fileURLToPath(new URL('..', import.meta.url));
  /** Existing local tooling dependencies; no installation or network request is performed. */
  const root = path.resolve(pkg, '../../..');
  /** Exclusive synthetic consumer directory removed even after a failed assertion. */
  const directory = await mkdtemp(
    path.join(os.tmpdir(), 'email-public-example-')
  );
  t.after(() => rm(directory, { recursive: true, force: true }));
  await symlink(
    path.join(root, 'node_modules'),
    path.join(directory, 'node_modules'),
    'dir'
  );
  await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  await copyFile(
    path.join(pkg, 'examples/bounded-send.ts'),
    path.join(directory, 'example.ts')
  );
  execFileSync(
    process.execPath,
    [
      path.join(root, 'node_modules/typescript/bin/tsc'),
      '--strict',
      '--target',
      'ES2022',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--types',
      'node',
      '--rootDir',
      directory,
      '--outDir',
      path.join(directory, 'out'),
      path.join(directory, 'example.ts'),
    ],
    { cwd: directory, stdio: 'pipe' }
  );
  /** Actually compiled example imports only the package public root. */
  const { createMailer } = await import(
    pathToFileURL(path.join(directory, 'out/example.js')).href
  );
  let submitted = 0;
  let closed = 0;
  /** Borrowed injected transport; captures no real recipient data and opens no SMTP socket. */
  const transport = {
    async sendMail(data) {
      submitted++;
      return { accepted: data.to, rejected: [] };
    },
    close() {
      closed++;
    },
  };
  /** Authorized example owner, closed separately from the borrowed native transport. */
  const mailer = createMailer(transport, async () => true);
  try {
    /** Public result must contain address-free acceptance counters. */
    const result = await mailer.receipt(
      'reader@example.test',
      new AbortController().signal
    );
    assert.equal(result.submissionStatus, 'accepted');
    assert.equal(result.counts.accepted, 1);
    assert.equal(submitted, 1);
    assert.doesNotMatch(JSON.stringify(result), /reader@example/);
  } finally {
    await mailer.close();
  }
  /** Denial must happen before a second transport submission. */
  const denied = createMailer(transport, async () => false);
  try {
    await assert.rejects(
      denied.receipt('reader@example.test', new AbortController().signal),
      (error) => error.code === 'EMAIL_FORBIDDEN'
    );
    assert.equal(submitted, 1);
  } finally {
    await denied.close();
  }
  assert.equal(closed, 0);
});
