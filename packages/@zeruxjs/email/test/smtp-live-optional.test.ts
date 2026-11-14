import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmailManager } from '../dist/index.js';

/** Explicit operator opt-in; formatting/static checks must never enable a live connection. */
const enabled = process.env.ZERUX_TEST_LIVE_SMTP === '1';
/** Private configured SMTP host read only when the operator runs this optional module; never log it. */
const host = process.env.ZERUX_TEST_SMTP_HOST;
/** Private configured SMTP account identity; never emit it in test diagnostics. */
const user = process.env.ZERUX_TEST_SMTP_USER;
/** Private configured SMTP password; never log or persist it in artifacts. */
const pass = process.env.ZERUX_TEST_SMTP_PASSWORD;
/** Explicit SMTP port, default 465; the ready gate also checks positive safe-integer syntax. */
const port = Number(process.env.ZERUX_TEST_SMTP_PORT ?? 465);
/** Existing explicit live-connection gate; this readability pass performs static checks only. */
const ready =
  enabled && host && user && pass && Number.isSafeInteger(port) && port > 0;

test(
  'opt-in real SMTP TLS + password authentication verification (no email sent)',
  { skip: !ready },
  async () => {
    /** Owned optional live SMTP manager; finally must close verification/send resources. */
    const manager = createEmailManager({
      accounts: [
        {
          name: 'live',
          smtp: {
            host,
            port,
            secure: port === 465,
            requireTLS: port !== 465,
            auth: { type: 'password', user, pass },
          },
          defaults: { from: user },
        },
      ],
    });
    try {
      assert.equal(await manager.verify('live'), true);
    } finally {
      await manager.close();
    }
  }
);

/** Explicit operator-approved destination; sending additionally requires the independent SEND opt-in. */
const recipient = process.env.ZERUX_TEST_SMTP_RECIPIENT;
test(
  'opt-in real SMTP acceptance, intentionally sends one harmless test message',
  { skip: !ready || !recipient || process.env.ZERUX_TEST_SMTP_SEND !== '1' },
  async () => {
    /** Owned optional live SMTP manager; finally must close verification/send resources. */
    const manager = createEmailManager({
      accounts: [
        {
          name: 'live',
          smtp: {
            host,
            port,
            secure: port === 465,
            requireTLS: port !== 465,
            auth: { type: 'password', user, pass },
          },
          defaults: { from: user },
        },
      ],
    });
    try {
      /** Private native SMTP outcome; assertions inspect status/count only, never raw address/response fields. */
      const result = await manager.send({
        to: recipient,
        subject: 'ZeruxJS opt-in SMTP integration test',
        text: 'Intentional SMTP acceptance check from a test account.',
      });
      assert.equal(result.submissionStatus, 'accepted');
      assert.equal(result.accepted.length, 1);
    } finally {
      await manager.close();
    }
  }
);
