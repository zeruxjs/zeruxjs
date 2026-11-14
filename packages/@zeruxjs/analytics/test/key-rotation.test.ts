import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createEmailTrackingService } from '../dist/index.js';

/** First fixture receipt, service, key or lease in this comparison. */
const first = {
  id: 'oct-2026',
  secret: 'long-and-private-first-secret-'.repeat(2),
};
/** Second fixture receipt, service, key or lease for replay/rotation/isolation checks. */
const second = {
  id: 'nov_2026',
  secret: 'second-super-private-tracking-secret-'.repeat(2),
};
/** Third synthetic rotation key, never a real provider credential. */
const third = {
  id: 'dec-2026',
  secret: 'third-super-private-tracking-secret-'.repeat(2),
};
/** Manager configured only against the fixture-owned or injected database. */
const analytics = { track: async () => undefined };
/** Fixed synthetic HTTPS origin; tests invoke handlers directly. */
const baseUrl = 'https://events.example.test';
/** Fixture factory varying only the explicitly supplied test options.
 * @param {object} options - Explicit fixture configuration overrides.
 * @returns {object} Fixture factory varying only the explicitly supplied test options. */
const make = (options) =>
  createEmailTrackingService({ analytics, baseUrl, ...options });
/** Synthetic connector/message context containing no real credentials or recipient data. */
const context = {
  id: 'mail-rotation',
  account: 'marketing',
  message: { tracking: { enabled: true, campaign: 'winter-sale' } },
};
/** Generated signed links or bounded fixture link extractor.
 * @param {object} tracking - Explicit synthetic tracking policy.
 * @returns {object} Generated signed links or bounded fixture link extractor. */
const links = (tracking) => {
  /** Authored inert HTML fixture; tests verify wrapping/escaping without a browser. */
  const html = tracking.instrumentHtml(
    '<body><a href="https://store.example.test/offer?customer=opaque">Offer</a></body>',
    context
  );
  /** URLs extracted from generated fixture markup. */
  const found = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((x) => x[1]);
  return {
    click: found.find((x) => x.includes('/click/')),
    open: found.find((x) => x.includes('/open/')),
  };
};
/** Synthetic Fetch request builder; it performs no outbound network call.
 * @param {string} url - Synthetic generated URL.
 * @returns {Request} Synthetic Fetch request builder; it performs no outbound network call. */
const request = (url) => new Request(url, { method: 'GET' });

// Existing single-secret users still emit *the same v2 wire format*.
test('v2 single-secret URLs survive a rotation to an explicit key ring', async () => {
  /** Earlier accepted token/lease/state kept to verify compatibility or fencing. */
  const old = make({ secret: first.secret });
  /** URLs issued before the synthetic key rotation. */
  const issued = links(old);
  assert.match(issued.click, /\/v2\.[A-Za-z0-9_-]+$/);
  /** New service verifying the explicitly retained previous key. */
  const rotated = make({ keyRing: { current: second, previous: [first] } });
  /** URLs emitted by the current rotated key. */
  const newer = links(rotated);
  assert.match(newer.click, /\/v3\.nov_2026\.[A-Za-z0-9_-]+$/);
  assert.equal(
    (await rotated.handle(request(issued.click))).headers.get('location'),
    'https://store.example.test/offer?customer=opaque'
  );
  assert.equal((await rotated.handle(request(issued.open))).status, 200);
  assert.equal((await rotated.handle(request(newer.click))).status, 302);
  assert.equal((await old.handle(request(newer.click))).status, 404);
});

test('v3 links stay valid across multiple rotations then fail closed after retiring their key', async () => {
  /** Intermediate synthetic key-ring generation. */
  const middle = make({ keyRing: { current: second, previous: [first] } });
  /** URLs issued before the synthetic key rotation. */
  const issued = links(middle);
  /** Later synthetic ring retaining only declared previous keys. */
  const future = make({
    keyRing: { current: third, previous: [second, first] },
  });
  assert.equal((await future.handle(request(issued.click))).status, 302);
  assert.equal((await future.handle(request(issued.open))).status, 200);
  /** Ring deliberately excluding the earlier signing key. */
  const oldKeyRetired = make({
    keyRing: { current: third, previous: [first] },
  });
  assert.equal((await oldKeyRetired.handle(request(issued.click))).status, 404);
  /** Tampered key-ID token that must fail authenticated binding. */
  const differentId = issued.click.replace('v3.nov_2026.', 'v3.dec-2026.');
  assert.equal(
    (await future.handle(request(differentId))).status,
    404,
    'key ID is bound into the authenticated ciphertext'
  );
  /** Changed wire token expected to fail verification. */
  const tamper = issued.click.replace(/.$/u, (ch) => (ch === 'A' ? 'B' : 'A'));
  assert.equal((await future.handle(request(tamper))).status, 404);
  assert.equal(
    (await future.handle(request(issued.click + '/extra'))).status,
    404
  );
});

test('legacy HMAC can be disabled without invalidating v2 or v3 encrypted links', async () => {
  /** Inert legacy signed-token fixture, never executed as code. */
  const payload = Buffer.from(
    JSON.stringify({
      kind: 'click',
      id: 'old-43',
      account: 'marketing',
      campaign: 'winter',
      url: 'https://store.example.test/legacy',
      expires: Date.now() + 120_000,
      nonce: 'legacy',
    })
  ).toString('base64url');
  /** Locally constructed legacy HMAC token for compatibility checks. */
  const legacy = `${baseUrl}/_analytics/email/click/${payload}.${createHmac('sha256', first.secret).update(payload).digest('base64url')}`;
  /** Existing single-secret encrypted token retained across key rotation. */
  const oldV2 = links(make({ secret: first.secret })).click;
  /** New service verifying the explicitly retained previous key. */
  const rotated = make({ keyRing: { current: second, previous: [first] } });
  assert.equal((await rotated.handle(request(legacy))).status, 302);
  /** Tracking service explicitly rejecting legacy readable HMAC tokens. */
  const strict = make({
    keyRing: { current: second, previous: [first] },
    acceptLegacyHmac: false,
  });
  assert.equal((await strict.handle(request(legacy))).status, 404);
  assert.equal((await strict.handle(request(oldV2))).status, 302);
  assert.equal((await strict.handle(request(links(strict).click))).status, 302);
});

test('key ring rejects ambiguous or unsafe configurations', () => {
  assert.throws(() => make({}), /32 bytes/);
  assert.throws(
    () => make({ secret: first.secret, keyRing: { current: second } }),
    /either/
  );
  assert.throws(
    () => make({ keyRing: { current: { id: 'weak', secret: 'short' } } }),
    /32 bytes/
  );
  assert.throws(
    () =>
      make({
        keyRing: {
          current: second,
          previous: [{ id: second.id, secret: first.secret }],
        },
      }),
    /duplicate/
  );
  assert.throws(
    () => make({ keyRing: { current: { ...second, id: 'bad.key' } } }),
    /key ID/
  );
  assert.throws(
    () =>
      make({
        keyRing: {
          current: second,
          previous: [first, third, first, third, first],
        },
      }),
    /key ring/
  );
  assert.throws(
    () => make({ secret: first.secret, acceptLegacyHmac: 'false' }),
    /legacy tracking token policy/
  );
});

test('rotatable links honor click allowlists and expiry validation', async () => {
  /** Fixture service issuing short-lived signed URLs. */
  const sender = make({ keyRing: { current: first }, ttlMs: 60_000 });
  /** Synthetic generated/request URL; no arbitrary remote fetch occurs. */
  const url = links(sender).click;
  /** Service/query explicitly denied by configured destination policy. */
  const blocked = make({
    keyRing: { current: second, previous: [first] },
    allowedLinkHosts: ['elsewhere.example.test'],
  });
  assert.equal((await blocked.handle(request(url))).status, 404);
  /** Service/query explicitly admitted by the fixture allowlist. */
  const allowed = make({
    keyRing: { current: second, previous: [first] },
    allowedLinkHosts: ['store.example.test'],
  });
  assert.equal((await allowed.handle(request(url))).status, 302);
  assert.equal(
    (await allowed.handle(new Request(url, { method: 'HEAD' }))).status,
    302
  );
});
