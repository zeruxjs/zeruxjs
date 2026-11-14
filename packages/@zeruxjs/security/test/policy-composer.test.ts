import { createRequire } from 'node:module';
/** CommonJS bridge retained for the package's existing require-based fixtures. */
const require = createRequire(import.meta.url);
/** Public native/library fixture APIs; tests retain explicit ownership of every acquired resource. */
const { test, mock } = require('node:test');
/** Native strict assertions; failures must remain visible after fixture cleanup. */
const assert = require('node:assert/strict');
/** Native crypto module used for real algorithm fixtures and scoped failure injection. */
const crypto = require('node:crypto');
/** Public native/library fixture APIs; tests retain explicit ownership of every acquired resource. */
const {
  createSecurityPolicy,
  createCspHash,
  assertSecurityNonce,
  SecurityPolicyConflictError,
  createSecurityHeaders,
} = require('../dist/index.js');

test('strict default policy, native hashes and response-owned nonces', () => {
  /** Native CSP hash descriptor for exact trusted inline fixture text. */
  const hash = createCspHash('console.log("known inline text")');
  assert.equal(
    hash.value,
    crypto
      .createHash('sha256')
      .update('console.log("known inline text")')
      .digest('base64')
  );
  /** Captured structural host composer; no teardown resource or request authority is implied. */
  const policy = createSecurityPolicy({
    https: true,
    resources: { 'script-src': ["'self'", hash] },
  });
  /** First independently generated per-response policy/nonce snapshot. */
  const a = policy.createResponse();
  /** Second independently generated snapshot; nonces must not be reused. */
  const b = policy.createResponse();
  assert.notEqual(a.nonce, b.nonce);
  assert.doesNotThrow(() => assertSecurityNonce(a.nonce));
  assert.ok(a.headers['content-security-policy'].includes(`nonce-${a.nonce}`));
  assert.ok(
    a.headers['content-security-policy'].includes(`'sha256-${hash.value}'`)
  );
  assert.equal(a.headers['cross-origin-opener-policy'], 'same-origin');
  assert.equal(a.headers['cross-origin-embedder-policy'], 'require-corp');
  assert.equal(a.headers['cross-origin-resource-policy'], 'same-origin');
  assert.equal(a.headers['x-content-type-options'], 'nosniff');
  assert.equal(a.headers['x-frame-options'], 'DENY');
  assert.ok(a.headers['strict-transport-security']);
  assert.ok(Object.isFrozen(a.headers));
});

test('exact host approvals merge deterministically and do not authorize another module', () => {
  /** Explicit synthetic trusted module requirements; registration never scans/executed arbitrary code. */
  const modules = [
    { module: 'images', resources: { 'img-src': ['https://images.example'] } },
    { module: 'api', resources: { 'connect-src': ['https://api.example'] } },
  ];
  /** Explicit synthetic policy input under test; mutation cannot silently widen captured state. */
  const options = {
    nonceDirectives: [],
    modules,
    approvals: {
      images: { 'img-src': ['https://images.example'] },
      api: { 'connect-src': ['https://api.example'] },
    },
  };
  /** Inert captured structural policy; every response owns its distinct nonce. */
  const composer = createSecurityPolicy(options);
  /** First synthetic response/state under a captured policy. */
  const first = composer.createResponse();
  /** Independent response under reversed declarations used to assert deterministic composition. */
  const second = createSecurityPolicy({
    ...options,
    modules: [...modules].reverse(),
  }).createResponse();
  assert.deepEqual(first, second);
  options.approvals.images['img-src'].push('https://evil.example');
  options.modules[0].resources['img-src'].push('https://evil.example');
  assert.deepEqual(composer.createResponse(), first);
  options.modules[0].resources['img-src'].pop();
  assert.deepEqual(
    createSecurityPolicy({ ...options, modules }).createResponse(),
    first
  );
  assert.throws(
    () =>
      createSecurityPolicy({
        modules: [
          ...modules,
          {
            module: 'unapproved',
            resources: { 'img-src': ['https://images.example'] },
          },
        ],
        approvals: options.approvals,
      }),
    (error) =>
      error instanceof SecurityPolicyConflictError &&
      error.conflicts.some(
        (item) =>
          item.module === 'unapproved' && item.reason === 'source-not-approved'
      )
  );
  assert.throws(
    () =>
      createSecurityPolicy({
        modules: [
          {
            module: 'frame',
            resources: { 'frame-src': ['https://frame.example'] },
          },
        ],
        approvals: { frame: { 'frame-src': ['https://frame.example'] } },
      }),
    SecurityPolicyConflictError
  );
});

test('conflicting isolation and disabled nonces are visible, never negotiated weaker', () => {
  assert.throws(
    () =>
      createSecurityPolicy({
        modules: [
          { module: 'popup', isolation: { coop: 'same-origin-allow-popups' } },
        ],
      }),
    (error) => error.conflicts[0].reason === 'isolation-mismatch'
  );
  assert.throws(
    () =>
      createSecurityPolicy({
        nonceDirectives: [],
        modules: [{ module: 'inline', requiresNonce: true }],
      }),
    SecurityPolicyConflictError
  );
  assert.throws(
    () => createSecurityPolicy({ resources: { 'script-src': ["'none'"] } }),
    SecurityPolicyConflictError
  );
  assert.equal(
    createSecurityPolicy({ coep: 'credentialless' }).createResponse().headers[
      'cross-origin-embedder-policy'
    ],
    'credentialless'
  );
});

test('development framing is explicit and prohibited in production config', () => {
  /** Explicit trusted development framing fixture; production must reject its allowances. */
  const development = createSecurityPolicy({
    mode: 'development',
    developmentFrameAncestors: ['http://localhost:3000'],
  }).createResponse();
  assert.ok(
    development.headers['content-security-policy'].includes(
      "frame-ancestors 'self' http://localhost:3000"
    )
  );
  assert.equal(development.headers['x-frame-options'], undefined);
  assert.throws(
    () =>
      createSecurityPolicy({
        developmentFrameAncestors: ['https://app.example'],
      }),
    /prohibited/
  );
  assert.throws(
    () =>
      createSecurityPolicy({
        mode: 'development',
        developmentFrameAncestors: ['http://*.localhost:3000'],
      }),
    TypeError
  );
  assert.ok(
    createSecurityPolicy()
      .createResponse()
      .headers['content-security-policy'].includes("frame-ancestors 'none'")
  );
});

test('structural parsing rejects header injection, unknown directives and malformed hashes', () => {
  for (const source of [
    'https://good.example\r\nX-Injected: yes',
    '*',
    'https:',
    'https://a.example/path',
    "'unsafe-eval'",
    "'nonce-from-client'",
  ]) {
    assert.throws(() =>
      createSecurityPolicy({ resources: { 'script-src': [source] } })
    );
  }
  assert.throws(() =>
    createSecurityPolicy({ resources: { 'script-src': ["'self'", "'none'"] } })
  );
  assert.throws(() =>
    createSecurityPolicy({ resources: { 'unrecognized-src': ["'self'"] } })
  );
  assert.throws(() =>
    createSecurityPolicy({
      resources: { 'script-src': [{ hash: 'sha256', value: 'AAAA' }] },
    })
  );
  assert.throws(
    () => createSecurityPolicy({ hsts: { maxAgeSeconds: -1 } }),
    /HSTS/
  );
  assert.throws(() => createSecurityPolicy({ hsts: [] }), /HSTS/);
  assert.throws(() =>
    createSecurityPolicy({
      modules: [{ module: 'bad', frameAncestors: ["'self'"] }],
    })
  );
  for (const crossOriginEmbedderPolicy of [
    'require-corp\r\nX: yes',
    'disabled',
  ]) {
    assert.throws(() => createSecurityHeaders({ crossOriginEmbedderPolicy }));
  }
});

test('nonce backend failure propagates without reusing an earlier response nonce', () => {
  /** Captured structural host composer; no teardown resource or request authority is implied. */
  const policy = createSecurityPolicy();
  /** First synthetic response/state under a captured policy. */
  const first = policy.createResponse();
  /** Injected native failure; public diagnostics must not expose private input values. */
  const failure = new Error('random provider unavailable');
  /** Owned scoped native-method mock; restore before later tests. */
  const replacement = mock.method(crypto, 'randomBytes', () => {
    throw failure;
  });
  try {
    assert.throws(
      () => policy.createResponse(),
      (error) => error === failure
    );
  } finally {
    replacement.mock.restore();
  }
  assert.notEqual(policy.createResponse().nonce, first.nonce);
});
