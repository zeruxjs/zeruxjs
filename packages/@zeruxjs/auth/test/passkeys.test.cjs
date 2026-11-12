/** Node test entry; no application server or live provider is started. */
const { test } = require('node:test');
/** Local assertions over synthetic cryptographic/persistence fixtures. */
const assert = require('node:assert/strict');
/** Native disposable software-authenticator cryptography; no private fixture keys are logged. */
const {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} = require('node:crypto');
/** Existing CBOR encoder used to create inert software authenticator fixtures. */
const { encodeCBOR } = require('@levischuck/tiny-cbor');
/** Built package public authentication exports under test. */
const auth = require('../dist/index.js');
/** Synthetic host-verified account/tenant; never a real user identity. */
const account = { tenant: 'tenant-a', account: 'alice' };
/** Verified synthetic session context; never read from user browser state. */
const session = 'server-session-id';
/** Canonical base64url encoding helper for disposable cryptographic fixture bytes.
 * @param {Uint8Array|string} bytes - Disposable byte/string input.
 * @returns {string} Canonical base64url encoding helper for disposable cryptographic fixture bytes. */
const b64 = (bytes) => Buffer.from(bytes).toString('base64url');
/** Synthetic expected password/byte digest or native fixture hash helper.
 * @param {Uint8Array|string} bytes - Disposable byte/string input.
 * @returns {Buffer} Synthetic expected password/byte digest or native fixture hash helper. */
const hash = (bytes) => createHash('sha256').update(bytes).digest();
/** Create a disposable ES256 software authenticator, not hardware/browser acceptance.
 * @returns {object} Public credential ID plus local registration/assertion builders.
 */
function authenticator() {
  /** Owned disposable ES256 software-authenticator keys; never logged or persisted. */
  const { privateKey, publicKey } = generateKeyPairSync('ec', {
    namedCurve: 'prime256v1',
  });
  /** Public JWK fields used to construct the software COSE key. */
  const jwk = publicKey.export({ format: 'jwk' });
  /** Random disposable credential identifier. */
  const id = randomBytes(32);
  /** Public COSE-encoded ES256 software credential, not executable source. */
  const cose = encodeCBOR(
    new Map([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, new Uint8Array(Buffer.from(jwk.x, 'base64url'))],
      [-3, new Uint8Array(Buffer.from(jwk.y, 'base64url'))],
    ])
  );
  /** Construct exact synthetic RP hash/flags/counter bytes for signing.
   * @param {string} rpId - Explicit fixture RP identity.
   * @param {number} flags - Synthetic presence/verification bits.
   * @param {number} counter - Synthetic authenticator counter.
   * @returns {Buffer} Inert authenticator data; not executed.
   */
  function data(rpId, flags, counter) {
    /** Owned authenticator flags/counter bytes for this fixture assertion. */
    const tail = Buffer.alloc(5);
    tail[0] = flags;
    tail.writeUInt32BE(counter, 1);
    return Buffer.concat([hash(rpId), tail]);
  }
  return {
    id: b64(id),
    registration(options, extra = {}) {
      /** Inert serialized client data or isolated provider client; no browser is started. */
      const client = Buffer.from(
        JSON.stringify({
          type: 'webauthn.create',
          challenge: options.challenge,
          origin: 'https://example.test',
          crossOrigin: false,
          ...extra.client,
        })
      );
      /** Two-byte credential-ID length used in the inert attestation fixture. */
      const length = Buffer.alloc(2);
      length.writeUInt16BE(id.length);
      /** Synthetic RP hash, flags and counter bytes signed by the software fixture. */
      const authData = Buffer.concat([
        data(extra.rpId ?? 'example.test', extra.flags ?? 0x45, 0),
        Buffer.alloc(16),
        length,
        id,
        cose,
      ]);
      return {
        id: b64(id),
        rawId: b64(id),
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64(client),
          attestationObject: b64(
            encodeCBOR(
              new Map([
                ['fmt', 'none'],
                ['attStmt', new Map()],
                ['authData', new Uint8Array(authData)],
              ])
            )
          ),
        },
      };
    },
    assertion(options, userHandle, counter = 1, extra = {}) {
      /** Inert serialized client data or isolated provider client; no browser is started. */
      const client = Buffer.from(
        JSON.stringify({
          type: 'webauthn.get',
          challenge: options.challenge,
          origin: 'https://example.test',
          crossOrigin: false,
          ...extra.client,
        })
      );
      /** Synthetic RP hash, flags and counter bytes signed by the software fixture. */
      const authData = data(
        extra.rpId ?? 'example.test',
        extra.flags ?? 5,
        counter
      );
      /** Software assertion signature; hostile cases deliberately tamper with it. */
      const signature = sign(
        'sha256',
        Buffer.concat([authData, hash(client)]),
        privateKey
      );
      if (extra.tamper) {
        signature[signature.length - 1] ^= 1;
      }
      return {
        id: b64(id),
        rawId: b64(id),
        type: 'public-key',
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64(client),
          authenticatorData: b64(authData),
          signature: b64(signature),
          userHandle,
        },
      };
    },
  };
}
/** Create isolated credential owners with deterministic clocks, explicit proof policy and scripted native failures.
 * @param {object} extra - Explicit trusted fixture overrides, default empty.
 * @returns {object|Promise<object>} Fixture handles with explicit close/clear teardown.
 */
function fixture(extra = {}) {
  let now = 10000,
    authorized = true;
  /** Owned reference/synthetic persistence; fixtures clear it only after managers drain. */
  const store = auth.createMemoryPasskeyStore();
  /** Explicit private fixture RP/provider/clock/authorization settings. */
  const config = {
    store,
    rpId: 'example.test',
    rpName: 'Example',
    origins: ['https://example.test'],
    bindingKey: randomBytes(32),
    authorizeFresh: async () => authorized,
    now: () => now,
    ...extra,
  };
  /** Owned verification manager, drained before clearing borrowed fixture stores. */
  const manager = auth.createPasskeyManager(config);
  /** Independent verification manager or tenant used to exercise atomic ownership. */
  const other = auth.createPasskeyManager(config);
  return {
    manager,
    other,
    config,
    store,
    deny: () => (authorized = false),
    advance: (value) => (now += value),
    close: async () => {
      await manager.close();
      await other.close();
      store.clear();
    },
  };
}
/** Complete one software registration through independent fixture managers.
 * @param {object} f - Owned isolated managers/store.
 * @param {object} device - Disposable software authenticator.
 * @returns {Promise<string>} Persisted opaque account user handle.
 */
async function enroll(f, device) {
  /** One-use server ceremony options bound to the synthetic account/session. */
  const begun = await f.manager.beginRegistration(account, session, 'Alice');
  /** Actual verified identity/state receipt checked by the following assertions. */
  const result = await f.other.completeRegistration(
    account,
    session,
    begun.id,
    device.registration(begun.options)
  );
  assert.equal(result.credentialId, device.id);
  return begun.options.user.id;
}
test('real software credential registration and ES256 assertion; replay/counter and ownership checks', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = fixture();
  /** Disposable software authenticator; not hardware or browser acceptance. */
  const device = authenticator();
  try {
    /** Persisted opaque user handle returned by successful fixture enrollment. */
    const handle = await enroll(f, device);
    /** One-use server ceremony options bound to the synthetic account/session. */
    const begun = await f.manager.beginAuthentication(account, session);
    /** Inert native assertion JSON generated by the software fixture. */
    const response = device.assertion(begun.options, handle);
    /** Actual verified identity/state receipt checked by the following assertions. */
    const result = await f.other.completeAuthentication(
      account,
      session,
      begun.id,
      response
    );
    assert.equal(result.method, 'webauthn');
    assert.equal(result.account, 'alice');
    await assert.rejects(
      f.manager.completeAuthentication(account, session, begun.id, response),
      { code: 'PASSKEY_DENIED' }
    );
    /** Fresh next-step code/ceremony proving old proof is not reused. */
    const next = await f.manager.beginAuthentication(account, session);
    await assert.rejects(
      f.manager.completeAuthentication(
        account,
        session,
        next.id,
        device.assertion(next.options, handle, 1)
      ),
      { code: 'PASSKEY_DENIED' }
    );
    /** Independent fresh ceremony for tenant/session ownership checks. */
    const third = await f.manager.beginAuthentication(account, session);
    await assert.rejects(
      f.manager.completeAuthentication(
        { ...account, tenant: 'other' },
        session,
        third.id,
        device.assertion(third.options, handle, 2)
      ),
      { code: 'PASSKEY_DENIED' }
    );
    await assert.rejects(
      f.manager.completeAuthentication(
        account,
        'wrong-session',
        third.id,
        device.assertion(third.options, handle, 2)
      ),
      { code: 'PASSKEY_DENIED' }
    );
    assert.equal(
      (
        await f.manager.completeAuthentication(
          account,
          session,
          third.id,
          device.assertion(third.options, handle, 2)
        )
      ).credentialId,
      device.id
    );
  } finally {
    await f.close();
  }
});
test('wrong origin/RP/challenge, absent presence/verification and cross-origin registration fail', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = fixture();
  /** Disposable software authenticator; not hardware or browser acceptance. */
  const device = authenticator();
  try {
    // Every hostile registration burns its one-use ceremony and stores no credential.
    for (const extra of [
      { client: { origin: 'https://evil.test' } },
      { rpId: 'evil.test' },
      { client: { challenge: 'wrong' } },
      { flags: 0x41 },
      { flags: 0x44 },
      { client: { crossOrigin: true } },
    ]) {
      /** One-use server ceremony options bound to the synthetic account/session. */
      const begun = await f.manager.beginRegistration(
        account,
        session,
        'Alice'
      );
      await assert.rejects(
        f.manager.completeRegistration(
          account,
          session,
          begun.id,
          device.registration(begun.options, extra)
        ),
        (error) =>
          error.code === 'PASSKEY_DENIED' && error.message === 'PASSKEY_DENIED'
      );
      await assert.rejects(
        f.manager.completeRegistration(
          account,
          session,
          begun.id,
          device.registration(begun.options)
        ),
        { code: 'PASSKEY_DENIED' }
      );
    }
    assert.equal(
      (await f.store.list({ ...account, rpId: 'example.test' })).length,
      0
    );
  } finally {
    await f.close();
  }
});
test('assertion signature, RP/origin, userHandle and UV failures are denied without accepting counters', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = fixture();
  /** Disposable software authenticator; not hardware or browser acceptance. */
  const device = authenticator();
  try {
    /** Persisted opaque user handle returned by successful fixture enrollment. */
    const handle = await enroll(f, device);
    // Each hostile assertion must deny without advancing the stored counter.
    for (const extra of [
      { tamper: true },
      { rpId: 'other.test' },
      { client: { origin: 'https://evil.test' } },
      { flags: 1 },
      { flags: 4 },
      { client: { crossOrigin: true } },
    ]) {
      /** One-use server ceremony options bound to the synthetic account/session. */
      const begun = await f.manager.beginAuthentication(account, session);
      await assert.rejects(
        f.manager.completeAuthentication(
          account,
          session,
          begun.id,
          device.assertion(begun.options, handle, 1, extra)
        ),
        { code: 'PASSKEY_DENIED' }
      );
    }
    /** One-use server ceremony options bound to the synthetic account/session. */
    const begun = await f.manager.beginAuthentication(account, session);
    await assert.rejects(
      f.manager.completeAuthentication(
        account,
        session,
        begun.id,
        device.assertion(begun.options, b64(randomBytes(32)))
      ),
      { code: 'PASSKEY_DENIED' }
    );
  } finally {
    await f.close();
  }
});
test('lost-device recovery atomically consumes all codes and revokes credentials/in-flight ceremonies', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = fixture();
  /** Disposable software authenticator; not hardware or browser acceptance. */
  const device = authenticator();
  try {
    /** Persisted opaque user handle returned by successful fixture enrollment. */
    const handle = await enroll(f, device);
    /** Private disposable recovery codes returned once by the fixture. */
    const codes = await f.manager.createRecoveryCodes(account, session, 60000);
    /** Outstanding test-controlled native/store work; actual settlement must retain its slot. */
    const pending = await f.manager.beginAuthentication(account, session);
    /** Concurrent outcomes used to assert exactly one credential/state completion. */
    const results = await Promise.allSettled([
      f.manager.recover(account, session, codes[0]),
      f.other.recover(account, session, codes[0]),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(
      results.find((r) => r.status === 'fulfilled').value.method,
      'recovery'
    );
    await assert.rejects(f.manager.recover(account, session, codes[1]), {
      code: 'PASSKEY_DENIED',
    });
    await assert.rejects(
      f.manager.completeAuthentication(
        account,
        session,
        pending.id,
        device.assertion(pending.options, handle)
      ),
      { code: 'PASSKEY_DENIED' }
    );
    assert.equal(
      (await f.store.list({ ...account, rpId: 'example.test' })).length,
      0
    );
    await enroll(f, authenticator()); // host's fresh-proof callback authorizes replacement enrollment
  } finally {
    await f.close();
  }
});
test('unauthorized enrollment/recovery enrollment/removal, expiry and invalid policies', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = fixture();
  try {
    /** Disposable software authenticator; not hardware or browser acceptance. */
    const device = authenticator();
    /** One-use server ceremony options bound to the synthetic account/session. */
    const begun = await f.manager.beginRegistration(account, session, 'Alice');
    f.deny();
    await assert.rejects(
      f.manager.beginRegistration(account, session, 'Alice'),
      { code: 'PASSKEY_DENIED' }
    );
    await assert.rejects(
      f.manager.completeRegistration(
        account,
        session,
        begun.id,
        device.registration(begun.options)
      ),
      { code: 'PASSKEY_DENIED' }
    );
    await assert.rejects(
      f.manager.createRecoveryCodes(account, session, 10000),
      { code: 'PASSKEY_DENIED' }
    );
    await assert.rejects(
      f.manager.removeCredential(account, session, device.id),
      { code: 'PASSKEY_DENIED' }
    );
    assert.throws(
      () =>
        auth.createPasskeyManager({
          ...f.config,
          origins: ['https://evil.test'],
        }),
      { code: 'PASSKEY_DENIED' }
    );
  } finally {
    await f.close();
  }
  /** Fixture whose trusted clock advances past exact proof expiry. */
  const expired = fixture();
  try {
    /** Disposable software authenticator; not hardware or browser acceptance. */
    const device = authenticator();
    /** One-use server ceremony options bound to the synthetic account/session. */
    const begun = await expired.manager.beginRegistration(
      account,
      session,
      'Alice'
    );
    expired.advance(120000);
    await assert.rejects(
      expired.manager.completeRegistration(
        account,
        session,
        begun.id,
        device.registration(begun.options)
      ),
      { code: 'PASSKEY_DENIED' }
    );
    /** Private disposable recovery codes returned once by the fixture. */
    const codes = await expired.manager.createRecoveryCodes(
      account,
      session,
      1000
    );
    expired.advance(1000);
    await assert.rejects(expired.manager.recover(account, session, codes[0]), {
      code: 'PASSKEY_DENIED',
    });
  } finally {
    await expired.close();
  }
});
test('store outage and pending cleanup do not expose payloads or erase host keys', async () => {
  /** Reference fixture retained while one manager injects a dependency failure. */
  const base = fixture();
  let release;
  /** Owned reference/synthetic persistence; fixtures clear it only after managers drain. */
  const store = {
    ...base.store,
    list: async () => {
      await new Promise((resolve) => (release = resolve));
      throw Error('private-db-credential');
    },
  };
  /** Owned verification manager, drained before clearing borrowed fixture stores. */
  const manager = auth.createPasskeyManager({
    ...base.config,
    store,
    maxPending: 1,
  });
  try {
    /** Outstanding test-controlled native/store work; actual settlement must retain its slot. */
    const pending = manager.beginRegistration(account, session, 'Alice');
    await Promise.resolve();
    await assert.rejects(manager.beginRegistration(account, session, 'Alice'), {
      code: 'PASSKEY_CAPACITY',
    });
    let closed = false;
    /** Observed close promise; it must wait for actual fixture work settlement. */
    const closing = manager.close().then(() => (closed = true));
    await Promise.resolve();
    assert.equal(closed, false);
    await assert.rejects(manager.beginRegistration(account, session, 'Alice'), {
      code: 'PASSKEY_CLOSED',
    });
    release();
    await assert.rejects(
      pending,
      (error) =>
        error.code === 'PASSKEY_UNAVAILABLE' &&
        !error.message.includes('credential') &&
        error.cause.message === 'private-db-credential'
    );
    await closing;
    assert.ok(base.config.bindingKey.some((byte) => byte !== 0));
  } finally {
    await manager.close();
    await base.close();
  }
});
test('recovery fences assertion already taken by a verifier and zero counters use revision CAS', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = fixture();
  /** Disposable software authenticator; not hardware or browser acceptance. */
  const device = authenticator();
  /** Exact synthetic RP/tenant/account tuple. */
  const scope = { ...account, rpId: 'example.test' };
  let racing;
  try {
    /** Persisted opaque user handle returned by successful fixture enrollment. */
    const handle = await enroll(f, device);
    /** Private disposable recovery codes returned once by the fixture. */
    const codes = await f.manager.createRecoveryCodes(account, session, 60000);
    /** One-use server ceremony options bound to the synthetic account/session. */
    const begun = await f.manager.beginAuthentication(account, session);
    let release, taken;
    /** Deterministic start gate for a blocked native/store operation. */
    const ready = new Promise((resolve) => (taken = resolve));
    /** Owned reference/synthetic persistence; fixtures clear it only after managers drain. */
    const store = {
      ...f.store,
      takeChallenge: async (...args) => {
        /** Actual verified identity/state receipt checked by the following assertions. */
        const result = await f.store.takeChallenge(...args);
        taken();
        await new Promise((resolve) => (release = resolve));
        return result;
      },
    };
    racing = auth.createPasskeyManager({ ...f.config, store });
    /** Outstanding assertion verification fenced by recovery in the race fixture. */
    const verification = racing.completeAuthentication(
      account,
      session,
      begun.id,
      device.assertion(begun.options, handle)
    );
    await ready;
    await f.other.recover(account, session, codes[0]);
    release();
    await assert.rejects(verification, { code: 'PASSKEY_DENIED' });
    assert.equal((await f.store.list(scope)).length, 0);
    // A fresh zero-counter credential can succeed, but the same stored revision cannot advance twice.
    /** New disposable software credential enrolled only after recovery/fresh host proof. */
    const newDevice = authenticator();
    await enroll(f, newDevice);
    /** Fresh one-use challenge bound to the account/session/kind. */
    const challenge = await f.manager.beginAuthentication(account, session);
    /** Consumed ceremony epoch used to test exact stored credential CAS. */
    const lease = await f.store.takeChallenge(
      scope,
      challenge.id,
      session,
      'authentication',
      10000
    );
    /** Detached current software credential revision used for counter-CAS assertions. */
    const [credential] = await f.store.list(scope);
    assert.equal(
      await f.store.advance(
        scope,
        credential.id,
        credential.revision,
        0,
        lease.epoch,
        false
      ),
      true
    );
    assert.equal(
      await f.store.advance(
        scope,
        credential.id,
        credential.revision,
        0,
        lease.epoch,
        false
      ),
      false
    );
  } finally {
    await racing?.close();
    await f.close();
  }
});
test('bounded direct response processing, challenge limits and RP-wide credential uniqueness', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = fixture();
  /** Disposable software authenticator; not hardware or browser acceptance. */
  const device = authenticator();
  try {
    await enroll(f, device);
    /** One-use server ceremony options bound to the synthetic account/session. */
    const begun = await f.manager.beginAuthentication(account, session);
    /** Deliberately over-budget inert browser response; it must reject before native success. */
    const oversized = {
      type: 'public-key',
      id: device.id,
      rawId: device.id,
      response: { clientDataJSON: 'a'.repeat(131073) },
    };
    await assert.rejects(
      f.manager.completeAuthentication(account, session, begun.id, oversized),
      { code: 'PASSKEY_DENIED' }
    );
    /** Distinct synthetic account under the same RP; credential IDs must remain unique. */
    const otherAccount = { ...account, account: 'bob' };
    /** Deliberate duplicate callback/credential candidate expected to deny. */
    const duplicate = await f.manager.beginRegistration(
      otherAccount,
      session,
      'Bob'
    );
    await assert.rejects(
      f.manager.completeRegistration(
        otherAccount,
        session,
        duplicate.id,
        device.registration(duplicate.options)
      ),
      { code: 'PASSKEY_DENIED' }
    );
    // Fill exactly the supported live challenge budget before asserting capacity denial.
    for (let i = 0; i < 8; i++) {
      await f.manager.beginAuthentication(account, session);
    }
    await assert.rejects(f.manager.beginAuthentication(account, session), {
      code: 'PASSKEY_CAPACITY',
    });
  } finally {
    await f.close();
  }
});
test('concurrent assertion claims allow one completion; non-counting authenticator still requires fresh challenge', async () => {
  /** Isolated fixture owners, scripted transport and deterministic fault controls. */
  const f = fixture();
  /** Disposable software authenticator; not hardware or browser acceptance. */
  const device = authenticator();
  try {
    /** Persisted opaque user handle returned by successful fixture enrollment. */
    const handle = await enroll(f, device);
    /** One-use server ceremony options bound to the synthetic account/session. */
    const begun = await f.manager.beginAuthentication(account, session);
    /** Inert native assertion JSON generated by the software fixture. */
    const response = device.assertion(begun.options, handle, 0);
    /** Concurrent outcomes used to assert exactly one credential/state completion. */
    const results = await Promise.allSettled([
      f.manager.completeAuthentication(account, session, begun.id, response),
      f.other.completeAuthentication(account, session, begun.id, response),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    /** Fresh next-step code/ceremony proving old proof is not reused. */
    const next = await f.manager.beginAuthentication(account, session);
    assert.equal(
      (
        await f.other.completeAuthentication(
          account,
          session,
          next.id,
          device.assertion(next.options, handle, 0)
        )
      ).method,
      'webauthn'
    );
  } finally {
    await f.close();
  }
});
