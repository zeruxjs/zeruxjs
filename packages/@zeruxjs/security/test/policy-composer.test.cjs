const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createSecurityPolicy, createCspHash, assertSecurityNonce, SecurityPolicyConflictError, createSecurityHeaders } = require('../dist/index.js');

test('strict default policy, native hashes and response-owned nonces', () => {
    const hash = createCspHash('console.log("known inline text")');
    assert.equal(hash.value, crypto.createHash('sha256').update('console.log("known inline text")').digest('base64'));
    const policy = createSecurityPolicy({ https: true, resources: { 'script-src': ["'self'", hash] } });
    const a = policy.createResponse(), b = policy.createResponse();
    assert.notEqual(a.nonce, b.nonce); assert.doesNotThrow(() => assertSecurityNonce(a.nonce));
    assert.match(a.headers['content-security-policy'], new RegExp(`nonce-${a.nonce.replace(/[+]/g, '\\+')}`));
    assert.ok(a.headers['content-security-policy'].includes(`'sha256-${hash.value}'`));
    assert.equal(a.headers['cross-origin-opener-policy'], 'same-origin');
    assert.equal(a.headers['cross-origin-embedder-policy'], 'require-corp');
    assert.equal(a.headers['cross-origin-resource-policy'], 'same-origin');
    assert.equal(a.headers['x-content-type-options'], 'nosniff');
    assert.equal(a.headers['x-frame-options'], 'DENY');
    assert.ok(a.headers['strict-transport-security']);
    assert.ok(Object.isFrozen(a.headers));
});

test('exact host approvals merge deterministically and do not authorize another module', () => {
    const modules = [
        { module: 'images', resources: { 'img-src': ['https://images.example'] } },
        { module: 'api', resources: { 'connect-src': ['https://api.example'] } }
    ];
    const options = { nonceDirectives: [], modules, approvals: { images: { 'img-src': ['https://images.example'] }, api: { 'connect-src': ['https://api.example'] } } };
    const composer = createSecurityPolicy(options);
    const first = composer.createResponse();
    const second = createSecurityPolicy({ ...options, modules: [...modules].reverse() }).createResponse();
    assert.deepEqual(first, second);
    options.approvals.images['img-src'].push('https://evil.example');
    options.modules[0].resources['img-src'].push('https://evil.example');
    assert.deepEqual(composer.createResponse(), first);
    options.modules[0].resources['img-src'].pop();
    assert.deepEqual(createSecurityPolicy({ ...options, modules }).createResponse(), first);
    assert.throws(() => createSecurityPolicy({ modules: [...modules, { module: 'unapproved', resources: { 'img-src': ['https://images.example'] } }], approvals: options.approvals }), error => error instanceof SecurityPolicyConflictError && error.conflicts.some(item => item.module === 'unapproved' && item.reason === 'source-not-approved'));
    assert.throws(() => createSecurityPolicy({ modules: [{module:'frame',resources:{'frame-src':['https://frame.example']}}], approvals:{frame:{'frame-src':['https://frame.example']}} }), SecurityPolicyConflictError);
});

test('conflicting isolation and disabled nonces are visible, never negotiated weaker', () => {
    assert.throws(() => createSecurityPolicy({ modules: [{ module:'popup', isolation:{coop:'same-origin-allow-popups'} }] }), error => error.conflicts[0].reason === 'isolation-mismatch');
    assert.throws(() => createSecurityPolicy({ nonceDirectives:[], modules:[{module:'inline',requiresNonce:true}] }), SecurityPolicyConflictError);
    assert.throws(() => createSecurityPolicy({ resources:{'script-src':["'none'"]} }), SecurityPolicyConflictError);
    assert.equal(createSecurityPolicy({ coep:'credentialless' }).createResponse().headers['cross-origin-embedder-policy'], 'credentialless');
});

test('development framing is explicit and prohibited in production config', () => {
    const development = createSecurityPolicy({ mode:'development', developmentFrameAncestors:['http://localhost:3000'] }).createResponse();
    assert.ok(development.headers['content-security-policy'].includes("frame-ancestors 'self' http://localhost:3000"));
    assert.equal(development.headers['x-frame-options'], undefined);
    assert.throws(() => createSecurityPolicy({ developmentFrameAncestors:['https://app.example'] }), /prohibited/);
    assert.throws(() => createSecurityPolicy({ mode:'development', developmentFrameAncestors:['http://*.localhost:3000'] }), TypeError);
    assert.ok(createSecurityPolicy().createResponse().headers['content-security-policy'].includes("frame-ancestors 'none'"));
});

test('structural parsing rejects header injection, unknown directives and malformed hashes', () => {
    for (const source of ['https://good.example\r\nX-Injected: yes', '*', 'https:', 'https://a.example/path', "'unsafe-eval'", "'nonce-from-client'"]) assert.throws(() => createSecurityPolicy({ resources:{'script-src':[source]} }));
    assert.throws(() => createSecurityPolicy({ resources:{'script-src':["'self'", "'none'"]} }));
    assert.throws(() => createSecurityPolicy({ resources:{'unrecognized-src':["'self'"]} }));
    assert.throws(() => createSecurityPolicy({ resources:{'script-src':[{hash:'sha256',value:'AAAA'}]} }));
    assert.throws(() => createSecurityPolicy({ hsts: {maxAgeSeconds: -1} }), /HSTS/);
    assert.throws(() => createSecurityPolicy({ hsts: [] }), /HSTS/);
    assert.throws(() => createSecurityPolicy({ modules: [{module:'bad',frameAncestors:["'self'"]}] }));
    for (const crossOriginEmbedderPolicy of ['require-corp\r\nX: yes','disabled']) assert.throws(() => createSecurityHeaders({crossOriginEmbedderPolicy}));
});

test('nonce backend failure propagates without reusing an earlier response nonce', () => {
    const policy = createSecurityPolicy(); const first = policy.createResponse();
    const failure = new Error('random provider unavailable');
    const replacement = mock.method(crypto, 'randomBytes', () => { throw failure; });
    try { assert.throws(() => policy.createResponse(), error => error === failure); }
    finally { replacement.mock.restore(); }
    assert.notEqual(policy.createResponse().nonce, first.nonce);
});
