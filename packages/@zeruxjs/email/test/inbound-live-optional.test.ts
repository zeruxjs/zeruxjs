/** Opt-in real protocol smoke. Never enabled in ordinary CI and never logs credentials or mail. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmailReceiver } from '../dist/index.js';

/** Explicit live-inbound opt-in; static readability checks never run this module. */
const enabled = process.env.ZERUX_TEST_LIVE_INBOUND === '1';
// Declare only the two explicit protocol cases; each retains its independent live opt-in gate.
for (const protocol of ['imap', 'pop3']) {
  /** Fixed environment-key namespace for the declared IMAP/POP3 protocol only. */
  const prefix = `ZERUX_TEST_${protocol.toUpperCase()}`;
  /** Private host setting; never log its value or infer a remote destination. */
  const host = process.env[`${prefix}_HOST`];
  /** Private configured mailbox account; it must not enter test artifacts. */
  const user = process.env[`${prefix}_USER`];
  /** Private configured protocol password; never log or copy it into diagnostics. */
  const password = process.env[`${prefix}_PASSWORD`];
  test(
    `optional live ${protocol.toUpperCase()} TLS authentication (read-only)`,
    {
      skip:
        !enabled || !host || !user || !password
          ? 'live credentials/test opt-in not provided'
          : false,
      timeout: 45000,
    },
    async () => {
      /** Owned optional native receiver; verify/folder operations settle before admission-only close. */
      const receiver = createEmailReceiver({
        accounts: [
          {
            name: 'live',
            protocol,
            host,
            port: Number(
              process.env[`${prefix}_PORT`] || (protocol === 'imap' ? 993 : 995)
            ),
            auth: { user, password },
            timeoutMs: 15000,
            maxMessagesPerPoll: 2,
          },
        ],
        mode: 'json',
      });
      try {
        assert.equal(await receiver.verify('live'), true);
        if (protocol === 'imap') {
          /** Private native folder inventory; assert only INBOX presence without dumping mailbox names. */
          const folders = await receiver.folders('live');
          assert.ok(Array.isArray(folders));
          assert.ok(folders.some((f) => f.path === 'INBOX'));
        }
      } finally {
        await receiver.close();
      }
    }
  );
}
