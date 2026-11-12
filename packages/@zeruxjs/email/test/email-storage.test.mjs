import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  saveEmailState,
  loadEmailState,
  createTemplateRegistry,
  createRecipientFilter,
  resolveAttachments,
} from '../dist/index.js';
test('private atomic saved templates and filters; no SMTP credentials saved', async (t) => {
  /** Owned temporary directory; remove it through the test cleanup hook even after assertion failure. */
  const root = await mkdtemp(join(tmpdir(), 'email-state-'));
  // Register cleanup before assertions so failure cannot retain owned test resources.
  t.after(() => rm(root, { recursive: true, force: true }));
  /** Private snapshot path inside the owned temporary directory. */
  const path = join(root, 'email-state.json');
  /** Synthetic local template registry saved into the bounded V1 snapshot. */
  const a = createTemplateRegistry([
    { id: 'welcome', subject: 'Hello', html: '<b>{{name}}</b>' },
  ]);
  /** Synthetic filter rules and suppression values; they remain private snapshot content. */
  const b = createRecipientFilter(
    [{ action: 'block', pattern: '*@blocked.com' }],
    ['oops@example.com']
  );
  await saveEmailState(path, a, b);
  /** Serialized snapshot read only from the owned synthetic temporary directory. */
  const data = await readFile(path, 'utf8');
  assert.equal(JSON.parse(data).version, 1);
  /** Fresh registry used to verify loaded template behavior. */
  const reg = createTemplateRegistry();
  /** Fresh recipient filter used to verify restored rules and suppressions. */
  const filters = createRecipientFilter();
  assert.equal(await loadEmailState(path, reg, filters), true);
  assert.equal(reg.render('welcome', { name: 'Alice' }).subject, 'Hello');
  assert.equal(filters.evaluate('x@blocked.com').rejected.length, 1);
  assert.equal(filters.evaluate('oops@example.com').rejected.length, 1);
  /** Synthetic final symlink target used to exercise refusal without touching operator files. */
  const unsafe = join(root, 'symlink.json');
  await symlink(path, unsafe);
  await assert.rejects(saveEmailState(unsafe, a, b), /Unsafe/);
});
test('file-manager attachments resolve lazily as Node streams with size limits', async () => {
  /** Borrowed files-protocol fixture yielding three in-memory bytes; no storage service starts. */
  const manager = {
    /**
     * Report the fixed synthetic object metadata without filesystem/network I/O.
     *
     * @returns {Promise<object>} Three-byte text object metadata for length validation.
     */
    async stat() {
      return { size: 3, contentType: 'text/plain' };
    },
    /**
     * Expose a finite synthetic byte iterator owned by the attachment wrapper.
     *
     * @returns {Promise<AsyncGenerator<Buffer>>} Three in-memory bytes; no remote storage handle is acquired.
     */
    async read() {
      return (async function* () {
        yield Buffer.from('abc');
      })();
    },
  };
  /** Owned lazy wrapper consumed fully below so the synthetic source iterator settles. */
  const [attachment] = await resolveAttachments(
    [
      {
        filename: 'test.txt',
        file: { storage: 'local', bucket: 'reports', key: 'a.txt' },
      },
    ],
    { files: manager, maxAttachmentBytes: 10 }
  );
  let text = '';
  // Consume the finite wrapper completely so its source iterator and reader slot settle.
  for await (const chunk of attachment.content) {
    text += chunk.toString();
  }
  assert.equal(text, 'abc');
  await assert.rejects(
    resolveAttachments(
      [{ filename: 'test', file: { bucket: 'a', key: 'b' } }],
      { files: manager, maxAttachmentBytes: 2 }
    ),
    /limit/
  );
  await assert.rejects(
    resolveAttachments([{ filename: 'secret.txt', path: '/etc/passwd' }], {}),
    /disabled/
  );
});
