const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const vm = require('node:vm');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const security = require('../dist/index.js');
const key = (id = 'active') => ({ id, key: crypto.randomBytes(32) });

test('destination encoders block script/style breaking values and preserve legacy JSON behavior', () => {
    const attack = '</script><script>alert("private")</script>\u2028\u2029&';
    assert.equal(security.escapeHtml(attack), security.escapeHtmlText(attack));
    assert.doesNotMatch(security.escapeHtmlAttribute('" onmouseover="evil`\n'), /["`\n]/);
    const encoded = security.serializeJavaScriptValue({ attack });
    assert.doesNotMatch(encoded, /[<>&\u2028\u2029]/);
    assert.deepEqual(vm.runInThisContext(encoded), { attack });
    const prototypeData = vm.runInThisContext(security.serializeJavaScriptValue(JSON.parse('{\"__proto__\":{\"privileged\":true}}')));
    assert.equal(Object.hasOwn(prototypeData, '__proto__'), true); assert.equal(prototypeData.privileged, undefined);
    assert.equal(vm.runInThisContext(security.serializeJavaScriptValue(null)), null);
    assert.equal(security.serializeJsonForScript(null), '{}');
    assert.equal(security.serializeJsonForScript(undefined), '{}');
    assert.throws(() => security.serializeJavaScriptValue(undefined), /not JSON serializable/);
    assert.throws(() => security.serializeJavaScriptValue({ toJSON() { throw new Error('private serialization payload'); } }), error => !String(error).includes('private'));
    const css = security.serializeCssString('";color:red}</style>\n');
    assert.ok(css.startsWith('"') && css.endsWith('"'));
    assert.doesNotMatch(css.slice(1, -1), /["<>;\n]/);
    assert.equal(security.sanitizeIdentifier('', '"><'), 'item');
    assert.equal(security.validateNavigationUrl('/a?q=1', { baseUrl: 'https://example.test' }), 'https://example.test/a?q=1');
    for (const url of ['javascript:alert(1)', 'data:text/html,evil', '//evil.test', 'https://user:private@example.test', ' https://example.test', 'https:\\evil.test']) assert.throws(() => security.validateNavigationUrl(url), /Invalid/);
    assert.throws(() => security.validateNavigationUrl('https://evil.test', { allowedOrigins: ['https://example.test'] }), /denied/);
});

test('AEAD records authenticate metadata, ciphertext and trusted external context', () => {
    const ring = security.createEncryptionKeyring({ current: key() });
    try {
        const record = ring.encrypt('private plaintext', 'tenant-a:record-1');
        assert.equal(record.v, 1); assert.equal(record.alg, 'A256GCM');
        assert.equal(Buffer.from(record.iv, 'base64url').length, 12);
        assert.equal(Buffer.from(record.tag, 'base64url').length, 16);
        assert.equal(ring.decrypt(JSON.parse(JSON.stringify(record)), 'tenant-a:record-1').toString(), 'private plaintext');
        assert.notEqual(record.iv, ring.encrypt('private plaintext', 'tenant-a:record-1').iv);
        assert.equal(ring.decrypt(ring.encrypt('', 'context'), 'context').length, 0);
        const mutations = [
            { ...record, v: 2 }, { ...record, alg: 'aes-256-cbc' }, { ...record, kid: 'unknown' },
            { ...record, iv: crypto.randomBytes(11).toString('base64url') },
            { ...record, tag: crypto.randomBytes(15).toString('base64url') },
            { ...record, ciphertext: Buffer.from('altered').toString('base64url') },
            { ...record, tag: crypto.randomBytes(16).toString('base64url') },
            { ...record, iv: record.iv + '=' }, { ...record, extra: true }
        ];
        for (const changed of mutations) assert.throws(() => ring.decrypt(changed, 'tenant-a:record-1'), security.SecurityRecordError);
        assert.throws(() => ring.decrypt(record, 'tenant-b:record-1'), error => error instanceof security.SecurityRecordError && !/private|tenant/.test(String(error)));
        let invoked = false;
        const getters = { ...record }; Object.defineProperty(getters, 'iv', { get() { invoked = true; throw new Error('private'); }, enumerable: true });
        assert.throws(() => ring.decrypt(getters, 'context'), security.SecurityRecordError); assert.equal(invoked, false);
        assert.throws(() => ring.decrypt(new Proxy({}, { ownKeys() { throw new Error('private reflection'); } }), 'context'), error => error instanceof security.SecurityRecordError && !String(error).includes('private'));
    } finally { ring.destroy(); ring.destroy(); }
    assert.throws(() => ring.encrypt('a', 'context'), /destroyed/);
});

test('rotation snapshots caller keys; previous keys only decrypt/verify', () => {
    const old = key('old'), current = key('current');
    const before = security.createEncryptionKeyring({ current: old });
    const after = security.createEncryptionKeyring({ current, previous: [old] });
    const retired = security.createEncryptionKeyring({ current });
    const record = before.encrypt('saved', 'context');
    old.key.fill(0);
    try {
        assert.equal(after.decrypt(record, 'context').toString(), 'saved');
        assert.equal(after.encrypt('new', 'context').kid, 'current');
        assert.throws(() => retired.decrypt(record, 'context'), security.SecurityRecordError);
        const macOldKey = key('old'), macNewKey = key('new');
        const signer = security.createMessageAuthenticator({ current: macOldKey });
        const verifier = security.createMessageAuthenticator({ current: macNewKey, previous: [macOldKey] });
        try {
            const tag = signer.sign('message', 'context');
            assert.equal(verifier.verify('message', tag, 'context'), true);
            assert.equal(verifier.verify('changed', tag, 'context'), false);
            assert.equal(verifier.verify('message', tag, 'other-context'), false);
            assert.equal(verifier.verify('message', { ...tag, alg: 'none' }, 'context'), false);
            assert.equal(verifier.verify('message', { ...tag, tag: tag.tag + '=' }, 'context'), false);
            assert.equal(verifier.sign('message', 'context').kid, 'new');
        } finally { signer.destroy(); verifier.destroy(); }
    } finally { before.destroy(); after.destroy(); retired.destroy(); }
});

test('algorithms, keys, limits and metadata fail closed without revealing inputs', () => {
    const privateValue = 'private-secret-value';
    for (const size of [0, 16, 31, 33, 64]) assert.throws(() => security.createEncryptionKeyring({ current: { id: 'test', key: Buffer.alloc(size) } }), /exactly 32/);
    assert.throws(() => security.createEncryptionKeyring({ current: { id: 'test', key: privateValue } }), error => !String(error).includes(privateValue));
    assert.throws(() => security.createEncryptionKeyring({ current: key(), algorithm: privateValue }), error => !String(error).includes(privateValue));
    const current = key();
    assert.throws(() => security.createEncryptionKeyring({ current, previous: [current] }), /duplicate/);
    assert.throws(() => security.createMessageAuthenticator({ current, algorithm: 'sha1' }), /Unsupported/);
    assert.throws(() => security.createEncryptionKeyring({ current, previous: Array.from({length:5}, (_, i) => key(String(i))) }), /four/);
    const ring = security.createEncryptionKeyring({ current, maxBytes: 2 });
    try {
        assert.throws(() => ring.encrypt(privateValue, 'context'), error => !String(error).includes(privateValue));
        assert.throws(() => ring.encrypt('a', ''), /context/);
    } finally { ring.destroy(); }
    for (const size of [0, 15, 65, Infinity]) assert.throws(() => security.createNonce(size), /nonce size/);
    for (const algorithm of ['md5', 'sha1', 'private-secret-value']) assert.throws(() => security.hashData('private', algorithm), error => !String(error).includes('private-secret-value'));
    assert.equal(security.hashData('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.equal(security.timingSafeEqualBytes(Buffer.from('equal'), Buffer.from('equal')), true);
    assert.equal(security.timingSafeEqualBytes(Buffer.from('equal'), Buffer.from('other')), false);
    assert.equal(security.timingSafeEqualBytes(Buffer.from('short'), Buffer.from('longer')), false);
});

test('native crypto dependency failures propagate separately from authentication rejection', () => {
    const ring = security.createEncryptionKeyring({ current: key() });
    const failure = new Error('native provider unavailable');
    const replacement = mock.method(crypto, 'createCipheriv', () => { throw failure; });
    try {
        assert.throws(() => ring.encrypt('private plaintext', 'context'), error => error instanceof security.SecurityCryptoError && error.cause === failure && !String(error).includes('private'));
    } finally { replacement.mock.restore(); ring.destroy(); }
});

test('runtime header policies and CSRF remain bounded and reject async or injected decisions', () => {
    assert.throws(() => security.serializeCookie('session', 'private', { sameSite: 'Lax\r\nInjected: true' }), /SameSite/);
    assert.throws(() => security.serializeCookie('session', 'private', { secure: 'false' }), /flag/);
    assert.throws(() => security.createSecurityHeaders({ frameOptions: 'DENY\r\nInjected: true' }), /frame policy/);
    assert.throws(() => security.createSecurityHeaders({ referrerPolicy: 'unknown' }), /referrer policy/);
    assert.throws(() => security.evaluateCors('https://example.test', { origins: async () => true }), /synchronous/);
    assert.throws(() => security.evaluateCors('https://example.test', { origins: () => Promise.reject(new Error('predicate failure')) }), /synchronous/);
    assert.throws(() => security.evaluateCors('https://example.test', { origins: () => 'yes' }), /synchronous/);
    assert.equal(security.isSameOriginRequest('https://example.test/extra', 'https://example.test'), false);
    const secret = Buffer.alloc(32, 1);
    const csrf = security.createCsrfProtection({ secret }); const token = csrf.issue('session'); secret.fill(2);
    assert.equal(csrf.verify(token, 'session'), true);
    assert.equal(csrf.verify([], 'session'), false);
    assert.equal(csrf.verify(token, 'other-session'), false);
    assert.throws(() => security.createCsrfProtection({ secret: Buffer.alloc(32), now: () => NaN }).issue('session'), /clock/);
});

test('installed exports and declarations work through shared tooling without source aliases', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-consumer-'));
    try {
        const npm = args => execFileSync('npm', [...args, '--cache', path.join(root, 'cache')], { cwd: root, encoding: 'utf8', timeout: 30000 });
        const packed = Object.values(JSON.parse(npm(['pack', path.resolve(__dirname, '..'), '--ignore-scripts', '--json', '--pack-destination', root])))[0];
        const deps = { '@zeruxjs/security': `file:${path.join(root, packed.filename)}` };
        for (const name of ['@types/node', 'undici-types', 'jose']) {
            const manifest = require.resolve(name + '/package.json');
            const dependency = Object.values(JSON.parse(npm(['pack', path.dirname(manifest), '--ignore-scripts', '--json', '--pack-destination', root])))[0];
            deps[name] = `file:${path.join(root, dependency.filename)}`;
        }
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'security-consumer', private: true, type: 'module', dependencies: deps }));
        npm(['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund']);
        fs.mkdirSync(path.join(root, 'src'));
        fs.writeFileSync(path.join(root, 'src/index.ts'), `import { createEncryptionKeyring, type EncryptedRecord } from '@zeruxjs/security/crypto';
import { createJwtSigner, createJwtVerifier, type JwtVerificationPolicy } from '@zeruxjs/security/jwt';
import { escapeHtmlAttribute, serializeJavaScriptValue } from '@zeruxjs/security/encoding';
import { createNonce, createCsrfProtection } from '@zeruxjs/security';
import { createSecurityPolicy, createCspHash, type SecurityPolicyOptions } from '@zeruxjs/security/policy';
const jwtPolicy: JwtVerificationPolicy = {algorithms:['HS256'],issuer:'https://issuer.example',audience:'example',type:'JWT',requiredClaims:['exp'],subject:'required',jti:'optional'};
const jwtKey={kty:'oct',k:'A'.repeat(43),alg:'HS256' as const,kid:'fixture'};
const signer=createJwtSigner({key:jwtKey,kid:'fixture',algorithm:'HS256',issuer:jwtPolicy.issuer,audience:'example',type:'JWT'});
const verifier=createJwtVerifier({keys:[jwtKey],policy:jwtPolicy});
const token=await signer.sign({scope:'read'},{subject:'example',ttlSeconds:60});
const verified=await verifier.verifyWithHeader(token);const algorithm:string=verified.protectedHeader.alg;void algorithm;
await signer.close();await verifier.close();
const policyOptions: SecurityPolicyOptions = {resources:{'script-src':[createCspHash('console.log(1)')]}};
const response = createSecurityPolicy(policyOptions).createResponse();
const csp: string = response.headers['content-security-policy']; void csp;
const ring = createEncryptionKeyring({current:{id:'one',key:new Uint8Array(32)}});
const record: EncryptedRecord = ring.encrypt('value','tenant:one');
const clear: Uint8Array = ring.decrypt(record,'tenant:one');
ring.destroy(); void clear; void createNonce; void createCsrfProtection;
void escapeHtmlAttribute(serializeJavaScriptValue({value:'safe'}));
// @ts-expect-error unsafe algorithm is not in the policy
createEncryptionKeyring({current:{id:'one',key:new Uint8Array(32)},algorithm:'aes-128-cbc'});
`);
        const { createTsConfig, checkTypes, createTypeScriptPreset } = await import('@zeruxjs/typescript');
        createTsConfig(root, { preset: 'node-server' });
        const result = checkTypes({ cwd: root, files: [], checkDependencies: true });
        assert.equal(result.ok, true, result.diagnostics.map(item => JSON.stringify(item.messageText)).join('\n'));
        fs.writeFileSync(path.join(root, 'src/browser.ts'), `import { escapeHtmlText, serializeCssString } from '@zeruxjs/security/encoding';
export const encoded: string = escapeHtmlText(serializeCssString('example'));`);
        fs.writeFileSync(path.join(root, 'tsconfig.browser.json'), JSON.stringify(createTypeScriptPreset('browser-library')));
        const browser = checkTypes({ cwd: root, files: ['src/browser.ts'], configFile: 'tsconfig.browser.json' });
        assert.equal(browser.ok, true, browser.diagnostics.map(item => JSON.stringify(item.messageText)).join('\n'));
        execFileSync(process.execPath, ['--input-type=module', '-e', "for(const name of ['@zeruxjs/security','@zeruxjs/security/encoding','@zeruxjs/security/crypto','@zeruxjs/security/policy','@zeruxjs/security/jwt']) await import(name);"], { cwd: root });
        assert.equal(fs.existsSync(path.join(root, 'node_modules/@zeruxjs/security/src')), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
