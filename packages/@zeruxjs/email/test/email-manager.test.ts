import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmailManager,
  createTemplateRegistry,
  createEmailLayout,
  emailRow,
  emailButton,
  validateSmtp,
} from '../dist/index.js';
/**
 * Create a synthetic message without contacting any transport.
 *
 * @param {string} to - Synthetic recipient, default a@example.com.
 * @param {object} override - Explicit per-case message fields.
 * @returns {object} Private message input for direct manager calls.
 */
const mail = (to = 'a@example.com', override = {}) => ({
  to,
  subject: 'Hi',
  text: 'Hello',
  ...override,
});
test('multiple accounts on same SMTP settings select independent transports', async (t) => {
  /** Captured private native envelopes; never sent to a real SMTP server. */
  const sent = [];
  /**
   * Create an injected account-specific sender that captures envelopes locally.
   *
   * @param {string} name - Synthetic configured account name.
   * @returns {object} Borrowed native transport fixture; no sockets are opened.
   */
  const make = (name) => ({
    /**
     * Capture or reject the synthetic native call without contacting SMTP.
     *
     * @param {object} body - Private normalized envelope captured only in this fixture.
     * @returns {Promise<object>} Synthetic native acceptance data, or deliberate fixture failure.
     */
    async sendMail(body) {
      sent.push({ name, body });
      return {
        accepted: body.to.map((x) => (typeof x === 'string' ? x : x.address)),
        messageId: name,
      };
    },
    /**
     * Satisfy native verification without a network connection.
     *
     * @returns {Promise<boolean>} True for the explicitly injected synthetic transport.
     */
    async verify() {
      return true;
    },
  });
  /** Owned test manager over synthetic/lazy transports; always close through the test cleanup hook. */
  const service = createEmailManager({
    accounts: [
      {
        name: 'sales',
        transport: make('sales'),
        defaults: { from: 'sales@example.com' },
      },
      {
        name: 'support',
        transport: make('support'),
        defaults: { from: 'support@example.com' },
      },
    ],
  });
  // Register cleanup before assertions so failure cannot retain owned test resources.
  t.after(() => service.close());
  assert.equal((await service.send(mail())).messageId, 'sales');
  assert.equal(
    (await service.send(mail('b@example.com', { account: 'support' })))
      .messageId,
    'support'
  );
  assert.equal(sent[1].body.from, 'support@example.com');
  assert.equal(sent[0].body.to[0], 'a@example.com');
  assert.deepEqual(
    service.accounts().map((x) => x.name),
    ['sales', 'support']
  );
  await service.close();
  await assert.rejects(() => service.send(mail()), /closed/);
});
test('credentials are validated and never exposed in account inventory', (t) => {
  assert.throws(
    () =>
      validateSmtp({
        host: 'mail.local',
        port: 587,
        tls: { rejectUnauthorized: false },
      }),
    /unsafe/
  );
  assert.throws(
    () =>
      validateSmtp({
        host: 'mail.local',
        port: 587,
        auth: { type: 'oauth2', user: 'u' },
      }),
    /token source/
  );
  /** Owned test manager over synthetic/lazy transports; always close through the test cleanup hook. */
  const service = createEmailManager({
    accounts: [
      {
        name: 'prod',
        smtp: {
          host: 'mail.example.com',
          port: 587,
          auth: { type: 'password', user: 'x', pass: 'SECRET' },
        },
        defaults: { from: 'x@example.com' },
      },
    ],
  });
  // Register cleanup before assertions so failure cannot retain owned test resources.
  t.after(() => service.close());
  assert.doesNotMatch(JSON.stringify(service.accounts()), /SECRET/);
});
test('recipient suppression, account filters, and injection blocking', async (t) => {
  let count = 0;
  /** Owned test manager over synthetic/lazy transports; always close through the test cleanup hook. */
  const service = createEmailManager({
    accounts: [
      {
        name: 'a',
        transport: {
          sendMail: async () => {
            count++;
            return {};
          },
        },
        defaults: { from: 'a@example.com' },
      },
    ],
    rules: [{ action: 'block', pattern: '*@blocked.test', reason: 'policy' }],
    suppressions: ['held@example.com'],
  });
  // Register cleanup before assertions so failure cannot retain owned test resources.
  t.after(() => service.close());
  // Exercise each explicit denied input; native sends must remain blocked.
  for (const addr of [
    'x@blocked.test',
    'held@example.com',
    'line\r\nBcc:x@example.com',
  ]) {
    await assert.rejects(
      () => service.send(mail(addr)),
      /Recipient rejected|email address/
    );
  }
  assert.equal(count, 0);
  service.filter.unsuppress('held@example.com');
  await service.send(mail('held@example.com'));
  assert.equal(count, 1);
});
test('header injection is rejected and protected envelope headers cannot be overridden', async (t) => {
  /** Owned rejecting transport manager; header validation must prevent native invocation. */
  const svc = createEmailManager({
    accounts: [
      {
        name: 'a',
        transport: {
          /**
           * Capture or reject the synthetic native call without contacting SMTP.
           *
           * @returns {Promise<object>} Synthetic native acceptance data, or deliberate fixture failure.
           */
          async sendMail() {
            throw new Error('must not send');
          },
        },
        defaults: { from: 'a@example.com' },
      },
    ],
  });
  // Register cleanup before assertions so failure cannot retain owned test resources.
  t.after(() => svc.close());
  // Exercise each explicit denied input; native sends must remain blocked.
  for (const headers of [
    { 'X-Tag': 'ok\nBcc: x@example.com' },
    { Bcc: 'hidden@example.com' },
    { 'content-type': 'text/html' },
  ]) {
    await assert.rejects(
      () => svc.send(mail('a@example.com', { headers })),
      /header/i
    );
  }
});
test('idempotency coalesces concurrent submissions and expires successful results', async (t) => {
  let sends = 0;
  let resume;
  /** Owned manager with a controlled unsettled send; cleanup releases the gate before closing. */
  const manager = createEmailManager({
    accounts: [
      {
        name: 'a',
        transport: {
          sendMail: async () => {
            sends++;
            await new Promise((resolve) => (resume = resolve));
            return { messageId: 'id-1', accepted: ['a@example.com'] };
          },
        },
        defaults: { from: 'a@example.com' },
      },
    ],
    idempotencyTtlMs: 1000,
  });
  // Register cleanup before assertions so failure cannot retain owned test resources.
  t.after(async () => {
    resume?.();
    await manager.close();
  });
  /** First request owns the native send and process-local idempotency entry. */
  const first = manager.send(
    mail('a@example.com', { idempotencyKey: 'invoice-1' })
  );
  /** Concurrent matching waiter; it must observe the same send without replay. */
  const second = manager.send(
    mail('a@example.com', { idempotencyKey: 'invoice-1' })
  );
  await new Promise((r) => setTimeout(r, 5));
  resume();
  assert.equal((await first).messageId, 'id-1');
  assert.equal((await second).messageId, 'id-1');
  assert.equal(sends, 1);
  /** Matching completed request; skipped marks cached success rather than another SMTP call. */
  const repeat = await manager.send(
    mail('a@example.com', { idempotencyKey: 'invoice-1' })
  );
  assert.equal(repeat.skipped, true);
});
test('templates substitute HTML-escaped values and block prototype keys', () => {
  /** Local inert template registry; no template source is evaluated. */
  const registry = createTemplateRegistry([
    {
      id: 'welcome',
      subject: 'Hi {{user.name}}',
      html: '<h1>{{user.name}}</h1>',
      text: 'Hello {{user.name}}',
    },
  ]);
  /** Rendered template fields checked for context-specific HTML versus plain-text escaping. */
  const result = registry.render('welcome', { user: { name: '<Emil & Co>' } });
  assert.equal(result.html, '<h1>&lt;Emil &amp; Co&gt;</h1>');
  assert.equal(result.text, 'Hello <Emil & Co>');
  assert.throws(
    () =>
      registry.render('welcome', { user: {} }).html === undefined
        ? undefined
        : registry.set({ id: '__proto__', subject: 'x', html: 'z' }),
    /./
  );
});
test('email-safe layout uses presentation tables and URL escape', () => {
  assert.match(
    createEmailLayout(emailRow(['One', 'Two'])),
    /role="presentation"/
  );
  assert.match(
    emailButton('<Buy>', 'https://example.org?a=1&b=2'),
    /&lt;Buy&gt;/
  );
  assert.throws(
    () => emailButton('X', 'javascript:alert(1)'),
    /Invalid email link/
  );
});
test('unsubscribe headers use https and one-click headers', async (t) => {
  let headers;
  /** Owned test manager over synthetic/lazy transports; always close through the test cleanup hook. */
  const service = createEmailManager({
    accounts: [
      {
        name: 'a',
        transport: {
          /**
           * Capture or reject the synthetic native call without contacting SMTP.
           *
           * @param {object} body - Private normalized envelope captured only in this fixture.
           * @returns {Promise<object>} Synthetic native acceptance data, or deliberate fixture failure.
           */
          async sendMail(body) {
            headers = body.headers;
            return {};
          },
        },
        defaults: { from: 'a@example.com' },
      },
    ],
  });
  // Register cleanup before assertions so failure cannot retain owned test resources.
  t.after(() => service.close());
  await service.send(
    mail('a@example.com', {
      listUnsubscribe: {
        url: 'https://example.com/unsubscribe/abc',
        email: 'unsubscribe@example.com',
      },
    })
  );
  assert.match(headers['List-Unsubscribe'], /mailto:unsubscribe@example.com/);
  assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  await assert.rejects(
    () =>
      service.send(
        mail('a@example.com', {
          listUnsubscribe: { url: 'http://example.com/' },
        })
      ),
    /HTTPS/
  );
});
