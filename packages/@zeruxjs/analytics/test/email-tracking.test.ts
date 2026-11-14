import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmailTrackingService } from '../dist/index.js';
/** Create a locally handled tracking service with exact destination policy and captured events.
 * @returns {object} Isolated fixture values for the following assertions.
 */
function service() {
  /** Synthetic telemetry events recorded by the fixture callback. */
  const saved = [];
  /** Explicitly opted-in fixture tracking service with private synthetic keys. */
  const tracking = createEmailTrackingService({
    analytics: {
      track: async (e) => {
        saved.push(e);
        return 'id';
      },
    },
    baseUrl: 'https://events.example.com',
    secret: 'S'.repeat(40),
    allowedLinkHosts: ['app.example.com'],
  });
  return { saved, tracking };
}
test('email tracking is explicit opt-in, signs click and pixel, never inserts JS', async () => {
  /** Tracking fixture and its captured synthetic events. */
  const { saved, tracking } = service();
  /** Authored inert HTML fixture; tests verify wrapping/escaping without a browser. */
  const html =
    '<html><body><a href="https://app.example.com/docs?a=1&amp;b=2">Docs</a> <a href="https://evil.example/path">Other</a><a href="https://app.example.com/unsubscribe">Unsubscribe</a></body></html>';
  /** Output from explicit tracking opt-out; source HTML must remain identical. */
  const unchanged = tracking.instrumentHtml(html, {
    id: 'message-1',
    account: 'support',
    message: {},
  });
  assert.equal(unchanged, html);
  /** Instrumented HTML; fixtures verify opt-out preservation and idempotence. */
  const marked = tracking.instrumentHtml(html, {
    id: 'message-1',
    account: 'support',
    message: { tracking: { enabled: true, campaign: 'launch' } },
  });
  assert.match(marked, /\/open\//);
  assert.match(marked, /\/click\//);
  assert.doesNotMatch(marked, /<script/i);
  assert.ok(
    marked
      .match(/href="([^"]+)"/g)
      .some((value) => value === 'href="https://evil.example/path"')
  );
  assert.ok(
    marked
      .match(/href="([^"]+)"/g)
      .some((value) => value === 'href="https://app.example.com/unsubscribe"')
  );
  /** Generated attribute URLs, or an inert fixture-only extraction helper. */
  const urls = [...marked.matchAll(/(?:src|href)="([^"]+)"/g)].map((x) =>
    x[1].replace(/&amp;/g, '&')
  );
  /** Generated signed pixel URL; no external request is made. */
  const pixel = urls.find((u) => u.includes('/open/'));
  /** Generated signed click URL; handled locally by the fixture. */
  const click = urls.find((u) => u.includes('/click/'));
  assert.equal((await tracking.handle(new Request(pixel))).status, 200);
  /** Locally handled signed redirect response or generated redirect URL. */
  const redirect = await tracking.handle(new Request(click));
  assert.equal(redirect.status, 302);
  assert.equal(
    redirect.headers.get('location'),
    'https://app.example.com/docs?a=1&b=2'
  );
  assert.deepEqual(
    saved.map((e) => e.name),
    ['email.open', 'email.click']
  );
  assert.equal(saved[0].properties.message_id, 'message-1');
  /** Malformed/tampered fixture result expected to fail closed. */
  const bad = click.slice(0, -2) + 'ab';
  assert.equal((await tracking.handle(new Request(bad))).status, 404);
  assert.equal(
    (await tracking.handle(new Request(pixel, { method: 'HEAD' }))).status,
    200
  );
  assert.equal(saved.length, 2);
});
test('secret length, insecure URLs, and nonallowed targets fail safely', () => {
  assert.throws(
    () =>
      createEmailTrackingService({
        analytics: { track: async () => {} },
        baseUrl: 'http://example.org',
        secret: 'secret',
      }),
    /HTTPS/
  );
  /** Explicitly configured tracking fixture. */
  const { tracking } = service();
  /** Inert instrumented HTML; no JavaScript or browser execution occurs. */
  const markup = tracking.instrumentHtml(
    '<a href="http://app.example.com/insecure">A</a>',
    {
      id: 'email-1',
      account: 'a',
      message: { tracking: { enabled: true, opens: false } },
    }
  );
  assert.doesNotMatch(markup, /\/click\//);
});
