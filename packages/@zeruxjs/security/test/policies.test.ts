import { createRequire } from 'node:module';
/** CommonJS bridge retained for the package's existing require-based fixtures. */
const require = createRequire(import.meta.url);
/** Public native/library fixture APIs; tests retain explicit ownership of every acquired resource. */
const { test, mock } = require('node:test');
/** Native strict assertions; failures must remain visible after fixture cleanup. */
const assert = require('node:assert/strict');
/** Native crypto module used for real algorithm fixtures and scoped failure injection. */
const crypto = require('node:crypto');
/** Native isolated expression evaluation used only to verify generated encoder output, never untrusted server input. */
const vm = require('node:vm');
/** Native filesystem owner used only within private temporary consumer fixtures. */
const fs = require('node:fs');
/** Native temporary-directory discovery; no operator application paths are inspected. */
const os = require('node:os');
/** Native path helpers for fixture-owned directories, never caller-selected shell interpolation. */
const path = require('node:path');
/** Public native/library fixture APIs; tests retain explicit ownership of every acquired resource. */
const { execFileSync } = require('node:child_process');
/** Built public security exports under test; tests never import private source aliases. */
const security = require('../dist/index.js');
/**
 * Explicit synthetic key/record input or fresh random key factory; never production secret material.
 * @param {string} id - Public synthetic key label; defaults to active.
 * @returns {object} Fresh native32-byte ephemeral key fixture.
 */
const key = (id = 'active') => ({ id, key: crypto.randomBytes(32) });

test('destination encoders block script/style breaking values and preserve legacy JSON behavior', () => {
  /** Fixed untrusted markup/control fixture; evaluation is confined to encoder-output assertions. */
  const attack = '</script><script>alert("private")</script>\u2028\u2029&';
  assert.equal(security.escapeHtml(attack), security.escapeHtmlText(attack));
  assert.doesNotMatch(
    security.escapeHtmlAttribute('" onmouseover="evil`\n'),
    /["`\n]/
  );
  /** Generated script-safe expression evaluated only in the explicit local VM fixture. */
  const encoded = security.serializeJavaScriptValue({ attack });
  assert.doesNotMatch(encoded, /[<>&\u2028\u2029]/);
  assert.deepEqual(vm.runInThisContext(encoded), { attack });
  /** Decoded own-property fixture proving __proto__ does not become an inherited privilege. */
  const prototypeData = vm.runInThisContext(
    security.serializeJavaScriptValue(
      JSON.parse('{"__proto__":{"privileged":true}}')
    )
  );
  assert.equal(Object.hasOwn(prototypeData, '__proto__'), true);
  assert.equal(prototypeData.privileged, undefined);
  assert.equal(
    vm.runInThisContext(security.serializeJavaScriptValue(null)),
    null
  );
  assert.equal(security.serializeJsonForScript(null), '{}');
  assert.equal(security.serializeJsonForScript(undefined), '{}');
  assert.throws(
    () => security.serializeJavaScriptValue(undefined),
    /not JSON serializable/
  );
  assert.throws(
    () =>
      security.serializeJavaScriptValue({
        toJSON() {
          throw new Error('private serialization payload');
        },
      }),
    (error) => !String(error).includes('private')
  );
  /** Quoted inert CSS string-token fixture; not a general stylesheet sanitizer. */
  const css = security.serializeCssString('";color:red}</style>\n');
  assert.ok(css.startsWith('"') && css.endsWith('"'));
  assert.doesNotMatch(css.slice(1, -1), /["<>;\n]/);
  assert.equal(security.sanitizeIdentifier('', '"><'), 'item');
  assert.equal(
    security.validateNavigationUrl('/a?q=1', {
      baseUrl: 'https://example.test',
    }),
    'https://example.test/a?q=1'
  );
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,evil',
    '//evil.test',
    'https://user:private@example.test',
    ' https://example.test',
    'https:\\evil.test',
  ]) {
    assert.throws(() => security.validateNavigationUrl(url), /Invalid/);
  }
  assert.throws(
    () =>
      security.validateNavigationUrl('https://evil.test', {
        allowedOrigins: ['https://example.test'],
      }),
    /denied/
  );
});

test('AEAD records authenticate metadata, ciphertext and trusted external context', () => {
  /** Owned encryption key snapshot; destroy even on failed assertions. */
  const ring = security.createEncryptionKeyring({ current: key() });
  try {
    /** Versioned local ciphertext/MAC fixture; authenticating it requires the expected external context. */
    const record = ring.encrypt('private plaintext', 'tenant-a:record-1');
    assert.equal(record.v, 1);
    assert.equal(record.alg, 'A256GCM');
    assert.equal(Buffer.from(record.iv, 'base64url').length, 12);
    assert.equal(Buffer.from(record.tag, 'base64url').length, 16);
    assert.equal(
      ring
        .decrypt(JSON.parse(JSON.stringify(record)), 'tenant-a:record-1')
        .toString(),
      'private plaintext'
    );
    assert.notEqual(
      record.iv,
      ring.encrypt('private plaintext', 'tenant-a:record-1').iv
    );
    assert.equal(
      ring.decrypt(ring.encrypt('', 'context'), 'context').length,
      0
    );
    /** Finite tampering fixtures covering format, key ID, nonce, tag, ciphertext and unknown fields. */
    const mutations = [
      { ...record, v: 2 },
      { ...record, alg: 'aes-256-cbc' },
      { ...record, kid: 'unknown' },
      { ...record, iv: crypto.randomBytes(11).toString('base64url') },
      { ...record, tag: crypto.randomBytes(15).toString('base64url') },
      { ...record, ciphertext: Buffer.from('altered').toString('base64url') },
      { ...record, tag: crypto.randomBytes(16).toString('base64url') },
      { ...record, iv: record.iv + '=' },
      { ...record, extra: true },
    ];
    for (const changed of mutations) {
      assert.throws(
        () => ring.decrypt(changed, 'tenant-a:record-1'),
        security.SecurityRecordError
      );
    }
    assert.throws(
      () => ring.decrypt(record, 'tenant-b:record-1'),
      (error) =>
        error instanceof security.SecurityRecordError &&
        !/private|tenant/.test(String(error))
    );
    let invoked = false;
    /** Accessor-bearing negative fixture; descriptor validation must not execute its getter. */
    const getters = { ...record };
    Object.defineProperty(getters, 'iv', {
      get() {
        invoked = true;
        throw new Error('private');
      },
      enumerable: true,
    });
    assert.throws(
      () => ring.decrypt(getters, 'context'),
      security.SecurityRecordError
    );
    assert.equal(invoked, false);
    assert.throws(
      () =>
        ring.decrypt(
          new Proxy(
            {},
            {
              ownKeys() {
                throw new Error('private reflection');
              },
            }
          ),
          'context'
        ),
      (error) =>
        error instanceof security.SecurityRecordError &&
        !String(error).includes('private')
    );
  } finally {
    ring.destroy();
    ring.destroy();
  }
  assert.throws(() => ring.encrypt('a', 'context'), /destroyed/);
});

test('rotation snapshots caller keys; previous keys only decrypt/verify', () => {
  /** Ephemeral retired key fixture; only retained snapshots may decrypt/verify its records. */
  const old = key('old');
  /** Ephemeral current key fixture selected for new records. */
  const current = key('current');
  /** Pre-operation owned keyring or state baseline used to prove mutation/rotation isolation. */
  const before = security.createEncryptionKeyring({ current: old });
  /** Owned rotated keyring retaining an explicit previous key. */
  const after = security.createEncryptionKeyring({ current, previous: [old] });
  /** Owned current-only ring used to reject records requiring an unretained key. */
  const retired = security.createEncryptionKeyring({ current });
  /** Versioned local ciphertext/MAC fixture; authenticating it requires the expected external context. */
  const record = before.encrypt('saved', 'context');
  old.key.fill(0);
  try {
    assert.equal(after.decrypt(record, 'context').toString(), 'saved');
    assert.equal(after.encrypt('new', 'context').kid, 'current');
    assert.throws(
      () => retired.decrypt(record, 'context'),
      security.SecurityRecordError
    );
    /** Ephemeral retired MAC key fixture. */
    const macOldKey = key('old');
    /** Ephemeral current MAC key fixture. */
    const macNewKey = key('new');
    /** Owned issuance/authentication scope; teardown releases copied key references. */
    const signer = security.createMessageAuthenticator({ current: macOldKey });
    /** Owned verification scope; close drains actual JOSE/JWKS/replay work. */
    const verifier = security.createMessageAuthenticator({
      current: macNewKey,
      previous: [macOldKey],
    });
    try {
      /** Versioned local native MAC metadata, never the original message or key. */
      const tag = signer.sign('message', 'context');
      assert.equal(verifier.verify('message', tag, 'context'), true);
      assert.equal(verifier.verify('changed', tag, 'context'), false);
      assert.equal(verifier.verify('message', tag, 'other-context'), false);
      assert.equal(
        verifier.verify('message', { ...tag, alg: 'none' }, 'context'),
        false
      );
      assert.equal(
        verifier.verify('message', { ...tag, tag: tag.tag + '=' }, 'context'),
        false
      );
      assert.equal(verifier.sign('message', 'context').kid, 'new');
    } finally {
      signer.destroy();
      verifier.destroy();
    }
  } finally {
    before.destroy();
    after.destroy();
    retired.destroy();
  }
});

test('algorithms, keys, limits and metadata fail closed without revealing inputs', () => {
  /** Fixed synthetic sensitive marker used only to assert generic error redaction. */
  const privateValue = 'private-secret-value';
  for (const size of [0, 16, 31, 33, 64]) {
    assert.throws(
      () =>
        security.createEncryptionKeyring({
          current: { id: 'test', key: Buffer.alloc(size) },
        }),
      /exactly 32/
    );
  }
  assert.throws(
    () =>
      security.createEncryptionKeyring({
        current: { id: 'test', key: privateValue },
      }),
    (error) => !String(error).includes(privateValue)
  );
  assert.throws(
    () =>
      security.createEncryptionKeyring({
        current: key(),
        algorithm: privateValue,
      }),
    (error) => !String(error).includes(privateValue)
  );
  /** Ephemeral current key fixture selected for new records. */
  const current = key();
  assert.throws(
    () => security.createEncryptionKeyring({ current, previous: [current] }),
    /duplicate/
  );
  assert.throws(
    () => security.createMessageAuthenticator({ current, algorithm: 'sha1' }),
    /Unsupported/
  );
  assert.throws(
    () =>
      security.createEncryptionKeyring({
        current,
        previous: Array.from({ length: 5 }, (_, i) => key(String(i))),
      }),
    /four/
  );
  /** Owned encryption key snapshot; destroy even on failed assertions. */
  const ring = security.createEncryptionKeyring({ current, maxBytes: 2 });
  try {
    assert.throws(
      () => ring.encrypt(privateValue, 'context'),
      (error) => !String(error).includes(privateValue)
    );
    assert.throws(() => ring.encrypt('a', ''), /context/);
  } finally {
    ring.destroy();
  }
  for (const size of [0, 15, 65, Infinity]) {
    assert.throws(() => security.createNonce(size), /nonce size/);
  }
  for (const algorithm of ['md5', 'sha1', 'private-secret-value']) {
    assert.throws(
      () => security.hashData('private', algorithm),
      (error) => !String(error).includes('private-secret-value')
    );
  }
  assert.equal(
    security.hashData('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  );
  assert.equal(
    security.timingSafeEqualBytes(Buffer.from('equal'), Buffer.from('equal')),
    true
  );
  assert.equal(
    security.timingSafeEqualBytes(Buffer.from('equal'), Buffer.from('other')),
    false
  );
  assert.equal(
    security.timingSafeEqualBytes(Buffer.from('short'), Buffer.from('longer')),
    false
  );
});

test('native crypto dependency failures propagate separately from authentication rejection', () => {
  /** Owned encryption key snapshot; destroy even on failed assertions. */
  const ring = security.createEncryptionKeyring({ current: key() });
  /** Injected native failure; public diagnostics must not expose private input values. */
  const failure = new Error('native provider unavailable');
  /** Owned scoped native-method mock; restore before later tests. */
  const replacement = mock.method(crypto, 'createCipheriv', () => {
    throw failure;
  });
  try {
    assert.throws(
      () => ring.encrypt('private plaintext', 'context'),
      (error) =>
        error instanceof security.SecurityCryptoError &&
        error.cause === failure &&
        !String(error).includes('private')
    );
  } finally {
    replacement.mock.restore();
    ring.destroy();
  }
});

test('runtime header policies and CSRF remain bounded and reject async or injected decisions', () => {
  assert.throws(
    () =>
      security.serializeCookie('session', 'private', {
        sameSite: 'Lax\r\nInjected: true',
      }),
    /SameSite/
  );
  assert.throws(
    () => security.serializeCookie('session', 'private', { secure: 'false' }),
    /flag/
  );
  assert.throws(
    () =>
      security.createSecurityHeaders({
        frameOptions: 'DENY\r\nInjected: true',
      }),
    /frame policy/
  );
  assert.throws(
    () => security.createSecurityHeaders({ referrerPolicy: 'unknown' }),
    /referrer policy/
  );
  assert.throws(
    () =>
      security.evaluateCors('https://example.test', {
        origins: async () => true,
      }),
    /synchronous/
  );
  assert.throws(
    () =>
      security.evaluateCors('https://example.test', {
        origins: () => Promise.reject(new Error('predicate failure')),
      }),
    /synchronous/
  );
  assert.throws(
    () =>
      security.evaluateCors('https://example.test', { origins: () => 'yes' }),
    /synchronous/
  );
  assert.equal(
    security.isSameOriginRequest(
      'https://example.test/extra',
      'https://example.test'
    ),
    false
  );
  /** Explicit synthetic key material; fixture values are not production credentials. */
  const secret = Buffer.alloc(32, 1);
  /** Session-bound legacy CSRF fixture; no public destroy method is invented. */
  const csrf = security.createCsrfProtection({ secret });
  /** Synthetic bounded signed/CSRF token; never a real user session. */
  const token = csrf.issue('session');
  secret.fill(2);
  assert.equal(csrf.verify(token, 'session'), true);
  assert.equal(csrf.verify([], 'session'), false);
  assert.equal(csrf.verify(token, 'other-session'), false);
  assert.throws(
    () =>
      security
        .createCsrfProtection({ secret: Buffer.alloc(32), now: () => NaN })
        .issue('session'),
    /clock/
  );
});

test('installed exports and declarations work through shared tooling without source aliases', async () => {
  /** Owned temporary installed-consumer root, removed in finally. */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'security-consumer-'));
  try {
    /**
     * Bounded shell-free npm subprocess helper confined to its fixture-owned directory/cache.
     * @param {string[]} args - Explicit npm arguments passed without shell interpolation.
     * @returns {string} Captured stdout; child failures/timeouts propagate.
     */
    const npm = (args) =>
      execFileSync('npm', [...args, '--cache', path.join(root, 'cache')], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000,
      });
    /** Package archive metadata from an explicit no-script local fixture pack. */
    const packed = Object.values(
      JSON.parse(
        npm([
          'pack',
          path.resolve(__dirname, '..'),
          '--ignore-scripts',
          '--json',
          '--pack-destination',
          root,
        ])
      )
    )[0];
    /** Private offline consumer dependency map using only locally packed installed sources. */
    const deps = {
      '@zeruxjs/security': `file:${path.join(root, packed.filename)}`,
    };
    for (const name of ['@types/node', 'undici-types', 'jose']) {
      /** Installed public package manifest path used to prepare the isolated offline consumer. */
      const manifest = require.resolve(name + '/package.json');
      /** Locally packed installed dependency archive; no registry/network installation occurs. */
      const dependency = Object.values(
        JSON.parse(
          npm([
            'pack',
            path.dirname(manifest),
            '--ignore-scripts',
            '--json',
            '--pack-destination',
            root,
          ])
        )
      )[0];
      deps[name] = `file:${path.join(root, dependency.filename)}`;
    }
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        name: 'security-consumer',
        private: true,
        type: 'module',
        dependencies: deps,
      })
    );
    npm([
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
    ]);
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(
      path.join(root, 'src/index.ts'),
      `import { createEncryptionKeyring, type EncryptedRecord } from '@zeruxjs/security/crypto';
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
`
    );
    /** Public native/library fixture APIs; tests retain explicit ownership of every acquired resource. */
    const { createTsConfig, checkTypes, createTypeScriptPreset } =
      await import('@zeruxjs/typescript');
    createTsConfig(root, { preset: 'node-server' });
    /** Independent decoded/public result or typecheck report used for exact assertions. */
    const result = checkTypes({
      cwd: root,
      files: [],
      checkDependencies: true,
    });
    assert.equal(
      result.ok,
      true,
      result.diagnostics
        .map((item) => JSON.stringify(item.messageText))
        .join('\n')
    );
    fs.writeFileSync(
      path.join(root, 'src/browser.ts'),
      `import { escapeHtmlText, serializeCssString } from '@zeruxjs/security/encoding';
export const encoded: string = escapeHtmlText(serializeCssString('example'));`
    );
    fs.writeFileSync(
      path.join(root, 'tsconfig.browser.json'),
      JSON.stringify(createTypeScriptPreset('browser-library'))
    );
    /** Browser-condition typecheck result for pure encoding only; not live browser/AT acceptance. */
    const browser = checkTypes({
      cwd: root,
      files: ['src/browser.ts'],
      configFile: 'tsconfig.browser.json',
    });
    assert.equal(
      browser.ok,
      true,
      browser.diagnostics
        .map((item) => JSON.stringify(item.messageText))
        .join('\n')
    );
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "for(const name of ['@zeruxjs/security','@zeruxjs/security/encoding','@zeruxjs/security/crypto','@zeruxjs/security/policy','@zeruxjs/security/jwt']) await import(name);",
      ],
      { cwd: root }
    );
    assert.equal(
      fs.existsSync(path.join(root, 'node_modules/@zeruxjs/security/src')),
      false
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
