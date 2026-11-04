const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const security = require('../dist/jwt-entry.js');
const jose = require('jose');
const base = { algorithms: ['HS256'], issuer: 'https://issuer.example', audience: 'client', type: 'JWT', requiredClaims: ['exp'], subject: 'required', jti: 'optional', now: () => 1000000 };
const claims = { iss: base.issuer, aud: 'client', sub: 'alice', exp: 1100, iat: 1000 };
const hs = { kty: 'oct', k: randomBytes(64).toString('base64url'), alg: 'HS256', kid: 'key' };
async function sign(payload = claims, key = hs, header = {}) { const imported = await jose.importJWK(key, key.alg); return new jose.SignJWT(payload).setProtectedHeader({ alg: key.alg, kid: key.kid, typ: 'JWT', ...header }).sign(imported); }
test('JWT claim/algorithm/type/key policy is explicit and malformed dates fail', async () => {
  const verifier = security.createJwtVerifier({ policy: base, keys: [hs] });
  try {
    const valid = await sign(); assert.equal((await verifier.verify(valid)).sub, 'alice');
    for (const payload of [{ ...claims, iss: 'wrong' }, { ...claims, aud: 'wrong' }, { ...claims, exp: 1000 }, { ...claims, nbf: 1001 }, { ...claims, sub: '' }, { ...claims, exp: null }, { ...claims, nbf: '1000' }, { ...claims, iat: 1000.5 }]) await assert.rejects(verifier.verify(await sign(payload)), { code: 'JWT_REJECTED' });
    for (const header of [{ typ: 'other' }, { kid: 'wrong' }, { jku: 'https://evil.example/keys' }, { x5u: 'https://evil.example/cert' }]) await assert.rejects(verifier.verify(await sign(claims, hs, header)), { code: 'JWT_REJECTED' });
    const wrong = { ...hs, k: randomBytes(64).toString('base64url') }; await assert.rejects(verifier.verify(await sign(claims, wrong)), { code: 'JWT_REJECTED' });
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', kid: 'key', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
    await assert.rejects(verifier.verify(none), { code: 'JWT_REJECTED' });
    assert.throws(() => security.createJwtVerifier({ policy: { ...base, algorithms: ['none'] }, keys: [hs] }));
    assert.throws(() => security.validateJwtKey({ ...hs, k: 'YQ' }), { code: 'JWT_REJECTED' });
  } finally { await verifier.close(); }
});
test('iat only has an age/future policy when declared; optional typ remains explicit', async () => {
  const plain = security.createJwtVerifier({ policy: { ...base, requiredClaims: [] }, keys: [hs] });
  const age = security.createJwtVerifier({ policy: { ...base, maxTokenAgeSeconds: 60 }, keys: [hs] });
  const optional = security.createJwtVerifier({ policy: { ...base, requireType: false }, keys: [hs] });
  try {
    assert.equal((await plain.verify(await sign({ iss: base.issuer, aud: 'client', sub: 'alice', iat: 1 }))).iat, 1);
    for (const iat of [900, 1001]) await assert.rejects(age.verify(await sign({ ...claims, iat })), { code: 'JWT_REJECTED' });
    const noType = await new jose.SignJWT(claims).setProtectedHeader({ alg: 'HS256', kid: 'key' }).sign(await jose.importJWK(hs));
    await assert.rejects(plain.verify(noType), { code: 'JWT_REJECTED' }); assert.equal((await optional.verify(noType)).sub, 'alice');
    await assert.rejects(optional.verify(await sign(claims, hs, { typ: 'wrong' })), { code: 'JWT_REJECTED' });
  } finally { await Promise.all([plain.close(), age.close(), optional.close()]); }
});
test('atomic JTI consume occurs only after verification, concurrent replay denied, outage is unavailable', async () => {
  const seen = new Set(), input = [], store = { async consume(value) { input.push(value); if (seen.has(value.key)) return false; seen.add(value.key); return true; } };
  const verifier = security.createJwtVerifier({ policy: { ...base, jti: { consume: store, maxTtlSeconds: 200 } }, keys: [hs] });
  try {
    const token = await sign({ ...claims, jti: 'PRIVATE_JTI' });
    const result = await Promise.allSettled([verifier.verify(token), verifier.verify(token)]); assert.equal(result.filter(r => r.status === 'fulfilled').length, 1);
    assert.match(input[0].key, /^[a-f0-9]{64}$/); assert.equal(JSON.stringify(input).includes('PRIVATE_JTI'), false);
    const calls = input.length; await assert.rejects(verifier.verify(await sign({ ...claims, jti: 'private', aud: 'wrong' }))); assert.equal(input.length, calls);
  } finally { await verifier.close(); }
  const outage = security.createJwtVerifier({ policy: { ...base, jti: { consume: { async consume() { throw Error('private backend detail'); } }, maxTtlSeconds: 200 } }, keys: [hs] });
  try { await assert.rejects(outage.verify(await sign({ ...claims, jti: 'x' })), error => error.code === 'JWT_UNAVAILABLE' && !error.message.includes('private')); } finally { await outage.close(); }
});
test('advertised JOSE variants use real runtime keys; disallowed curves and key use fail', async () => {
  const rsa = await jose.generateKeyPair('RS256', { extractable: true });
  for (const algorithm of ['HS256','HS384','HS512','RS256','RS384','RS512','PS256','PS384','PS512','ES256','ES384','ES512','EdDSA']) {
    let signing, key;
    if (algorithm.startsWith('HS')) { key = { ...hs, alg: algorithm }; signing = await jose.importJWK(key); }
    else {
      const pair = algorithm.startsWith('RS') || algorithm.startsWith('PS') ? rsa : await jose.generateKeyPair(algorithm, { extractable: true });
      key = { ...await jose.exportJWK(pair.publicKey), kid: 'key', alg: algorithm }; signing = pair.privateKey;
      // RSA WebCrypto keys carry algorithm restrictions; import the same exported private material for PS/RS variants.
      if (algorithm.startsWith('RS') || algorithm.startsWith('PS')) signing = await jose.importJWK({ ...await jose.exportJWK(pair.privateKey), alg: algorithm }, algorithm);
    }
    const verifier = security.createJwtVerifier({ policy: { ...base, algorithms: [algorithm] }, keys: [key] });
    try { const token = await new jose.SignJWT(claims).setProtectedHeader({ alg: algorithm, kid: 'key', typ: 'JWT' }).sign(signing); assert.equal((await verifier.verify(token)).sub, 'alice'); } finally { await verifier.close(); }
  }
  for (const key of [{ ...hs, use: 'enc' }, { ...hs, key_ops: ['sign'] }, { kty: 'OKP', crv: 'Ed448', x: randomBytes(57).toString('base64url'), kid: 'key', alg: 'EdDSA' }, { kty: 'EC', crv: 'secp256k1', x: randomBytes(32).toString('base64url'), y: randomBytes(32).toString('base64url'), kid: 'key', alg: 'ES256K' }]) assert.throws(() => security.validateJwtKey(key), { code: 'JWT_REJECTED' });
});
test('bounded JWKS rotation, failed refresh, no stale expired keys and cancelled readers', async () => {
  const pair = await jose.generateKeyPair('ES256', { extractable: true }), pub = await jose.exportJWK(pair.publicKey);
  let kid = 'one', calls = 0, fail = false;
  const source = security.createJwtJwks({ url: 'https://issuer.example/keys', allowedUrls: ['https://issuer.example/keys'], cacheMs: 20, cooldownMs: 1, transport: async (url, init) => { assert.equal(url, 'https://issuer.example/keys'); assert.equal(init.redirect, 'error'); calls++; if (fail) throw Error('private url secret'); return Response.json({ keys: [{ ...pub, kid, alg: 'ES256' }] }); } });
  try {
    assert.equal((await source.getKeys('one'))[0].kid, 'one'); await source.getKeys('one'); assert.equal(calls, 1);
    await new Promise(resolve => setTimeout(resolve, 3)); kid = 'two'; assert.equal((await source.getKeys('two'))[0].kid, 'two'); assert.equal(calls, 2);
    await new Promise(resolve => setTimeout(resolve, 22)); fail = true; await assert.rejects(source.getKeys('two'), error => error.code === 'JWT_UNAVAILABLE' && !error.message.includes('secret'));
  } finally { await source.close(); }
  let cancelled = 0;
  const slow = security.createJwtJwks({ url: 'https://issuer.example/keys', allowedUrls: ['https://issuer.example/keys'], timeoutMs: 10, transport: async () => new Response(new ReadableStream({ cancel() { cancelled++; } }), { headers: { 'content-type': 'application/json' } }) });
  try { await assert.rejects(slow.getKeys('key'), { code: 'JWT_UNAVAILABLE' }); } finally { await slow.close(); }
  assert.equal(cancelled, 1); assert.deepEqual(slow.getDiagnostics(), { closed: true, cachedKeys: 0, pending: false });
  assert.throws(() => security.createJwtJwks({ url: 'https://evil.example/keys', allowedUrls: ['https://issuer.example/keys'], transport: fetch }), /denied/);
});
test('explicit signer issues bounded claims through JOSE and retires owned key references on close', async () => {
  const signer = security.createJwtSigner({ key: hs, kid: 'key', algorithm: 'HS256', issuer: base.issuer, audience: 'client', type: 'JWT', now: () => 1000000 });
  const verifier = security.createJwtVerifier({ policy: base, keys: [hs] });
  try {
    const token = await signer.sign({ scope: 'read' }, { subject: 'alice', ttlSeconds: 100 }); assert.equal((await verifier.verify(token)).scope, 'read');
    await assert.rejects(signer.sign({ exp: 2000 }, { subject: 'alice', ttlSeconds: 100 }), { code: 'JWT_REJECTED' });
    await assert.rejects(signer.sign({}, { subject: 'alice', ttlSeconds: 1000000 }), { code: 'JWT_REJECTED' });
  } finally { await signer.close(); await verifier.close(); }
  await assert.rejects(signer.sign({}, { subject: 'alice', ttlSeconds: 1 }), { code: 'JWT_CLOSED' });
});
test('verification cancellation retains native slot until settlement and close respects borrowed source', async () => {
  const pair = await jose.generateKeyPair('ES256', { extractable: true }), key = { ...await jose.exportJWK(pair.publicKey), alg: 'ES256', kid: 'key' };
  let release, started, closes = 0; const ready = new Promise(resolve => started = resolve);
  const source = { getKeys: async () => { started(); await new Promise(resolve => release = resolve); return [key]; }, close() { closes++; } };
  const verifier = security.createJwtVerifier({ policy: { ...base, algorithms: ['ES256'] }, jwks: source, maxPending: 1 });
  const token = await new jose.SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: 'key', typ: 'JWT' }).sign(pair.privateKey), controller = new AbortController();
  const work = verifier.verify(token, { signal: controller.signal }); await ready; controller.abort(); await assert.rejects(work, { code: 'JWT_UNAVAILABLE' });
  assert.equal(verifier.getDiagnostics().pending, 1); await assert.rejects(verifier.verify(token), { code: 'JWT_OVERLOAD' });
  let settled = false; const closing = verifier.close().then(() => settled = true); await Promise.resolve(); assert.equal(settled, false); release(); await closing;
  assert.equal(closes, 0); assert.equal(verifier.getDiagnostics().pending, 0); await assert.rejects(verifier.verify(token), { code: 'JWT_CLOSED' });
});
test('JWKS malformed/oversized payload and symmetric remote keys are unavailable, cleanup cancels readers', async () => {
  for (const [body, maxBytes] of [[JSON.stringify({ keys: [hs] }), 1000], ['{'.repeat(100), 20]]) {
    let cancelled = 0;
    const source = security.createJwtJwks({ url: 'https://issuer.example/keys', allowedUrls: ['https://issuer.example/keys'], maxBytes, transport: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(body)); if(maxBytes===1000)controller.close(); }, cancel() { cancelled++; } }), { headers: { 'content-type': 'application/json' } }), timeoutMs: 10 });
    try { await assert.rejects(source.getKeys('key'), { code: 'JWT_UNAVAILABLE' }); } finally { await source.close(); }
    assert.equal(cancelled, maxBytes===1000?0:1);
  }
});
test('asymmetric signer uses required bounded private material for RSA, EC and Ed25519', async () => {
  for (const algorithm of ['PS256','ES256','EdDSA']) {
    const pair = await jose.generateKeyPair(algorithm, { extractable: true }), pub = { ...await jose.exportJWK(pair.publicKey), alg: algorithm, kid: 'private-fixture' }, secret = await jose.exportJWK(pair.privateKey);
    const options = { key: secret, kid: pub.kid, algorithm, issuer: base.issuer, audience: 'client', type: 'JWT', now: () => 1000000 };
    const signer = security.createJwtSigner(options), verifier = security.createJwtVerifier({ keys: [pub], policy: { ...base, algorithms: [algorithm] } });
    try { assert.equal((await verifier.verify(await signer.sign({}, { subject: 'alice', ttlSeconds: 60 }))).sub, 'alice'); }
    finally { await signer.close(); await verifier.close(); }
    assert.throws(() => security.createJwtSigner({ ...options, key: pub }), { code: 'JWT_REJECTED' });
    assert.throws(() => security.createJwtSigner({ ...options, key: { ...secret, d: 'A'.repeat(2000) } }), error => error.code === 'JWT_REJECTED' && !error.message.includes('AAAA'));
  }
});
