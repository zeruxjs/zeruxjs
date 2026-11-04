import { createHmac, randomBytes } from 'node:crypto';
import type { AuthAccount } from './shared-auth.js';
import { PasskeyError, passkeyDenied, passkeyText, passkeyBase64, validatePasskeyCredential, validatePasskeyScope, type PasskeyStore, type PasskeyScope, type PasskeyCredential, type PasskeyChallenge } from './passkey-store.js';

/** JSON options are sent to a WebAuthn browser client; convert base64url fields for the native browser API. */
export interface PasskeyRegistrationOptions {
    challenge: string; rp: { id?: string; name: string }; user: { id: string; name: string; displayName: string };
    pubKeyCredParams: { type: 'public-key'; alg: number }[];
    timeout?: number; attestation?: string; excludeCredentials?: { id: string; type: string; transports?: string[] }[];
    authenticatorSelection?: { residentKey?: string; requireResidentKey?: boolean; userVerification?: string; authenticatorAttachment?: string };
}
export interface PasskeyAuthenticationOptions {
    challenge: string; rpId?: string; timeout?: number; userVerification?: string;
    allowCredentials?: { id: string; type: string; transports?: string[] }[];
}
export interface PasskeyIdentity extends AuthAccount { method: 'webauthn' | 'recovery'; verifiedAt: number; credentialId?: string }
export interface PasskeyManagerOptions {
    store: PasskeyStore; rpId: string; rpName: string; origins: readonly string[];
    /** Stable separate HMAC key for user handles and recovery-code digests. Keep outside credential storage. */
    bindingKey: Uint8Array;
    authorizeFresh(account: Readonly<AuthAccount>, action: 'enroll' | 'remove' | 'recovery-enroll', session: string): Promise<boolean>;
    now?: () => number; challengeTtlMs?: number; maxPending?: number;
}
type Library = typeof import('@simplewebauthn/server', { with: { 'resolution-mode': 'import' } });
let library: Promise<Library> | undefined;
// Import only on configured use. Failure stays actionable when installed with --omit=optional.
async function backend(): Promise<Library> {
    try { return await (library ??= import('@simplewebauthn/server')); }
    catch (cause) { library = undefined; throw new PasskeyError('PASSKEY_UNAVAILABLE', { cause }); }
}
function responseObject(value: unknown): Record<string, any> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw passkeyDenied();
    let nodes = 0, budget = 131072;
    function clone(input: unknown, depth: number): any {
        if (++nodes > 128 || depth > 5) throw passkeyDenied();
        if (typeof input === 'string') {
            if (input.length > budget) throw passkeyDenied();
            budget -= Buffer.byteLength(input); if (budget < 0) throw passkeyDenied(); return input;
        }
        if (input === null || typeof input === 'boolean' || typeof input === 'number' && Number.isFinite(input)) return input;
        if (!input || typeof input !== 'object') throw passkeyDenied();
        if (Array.isArray(input)) {
            if (input.length > 32) throw passkeyDenied();
            return input.map(item => clone(item, depth + 1));
        }
        const descriptors = Object.getOwnPropertyDescriptors(input), entries = Object.entries(descriptors);
        if (entries.length > 32) throw passkeyDenied();
        const output: Record<string, unknown> = Object.create(null);
        for (const [name, descriptor] of entries) {
            if (!('value' in descriptor) || name.length > 64 || ['__proto__', 'constructor', 'prototype'].includes(name)) throw passkeyDenied();
            output[name] = clone(descriptor.value, depth + 1);
        }
        return output;
    }
    const copy = clone(value, 0);
    if (copy.type !== 'public-key' || !passkeyBase64(copy.id, 1024) || copy.rawId !== copy.id || !copy.response || typeof copy.response !== 'object' || !passkeyBase64(copy.response.clientDataJSON, 8192)) throw passkeyDenied();
    const client = JSON.parse(Buffer.from(copy.response.clientDataJSON, 'base64url').toString('utf8'));
    // This narrow API supports same-origin ceremonies only, never embedded cross-origin delegation.
    if (!client || client.crossOrigin !== undefined && client.crossOrigin !== false || client.topOrigin !== undefined) throw passkeyDenied();
    return copy;
}

/** Account-bound WebAuthn step-up. Host supplies verified account/session, HTTP admission and atomic storage.
 * No automatic session issuance, redirects, browser actions, sockets or global verifier settings. */
export function createPasskeyManager(options: PasskeyManagerOptions) {
    if (!options || options.store?.capability !== 'passkey-atomic-v1' || typeof options.authorizeFresh !== 'function' || !(options.bindingKey instanceof Uint8Array) || options.bindingKey.length !== 32 || !passkeyText(options.rpName) || !Array.isArray(options.origins) || options.origins.length < 1 || options.origins.length > 8) throw passkeyDenied();
    const store = options.store, authorize = options.authorizeFresh, rpId = options.rpId, rpName = options.rpName;
    validatePasskeyScope({ tenant: 'validation', account: 'validation', rpId });
    for (const method of ['list', 'putChallenge', 'takeChallenge', 'insert', 'advance', 'remove', 'replaceRecovery', 'recover'] as const) if (typeof store[method] !== 'function') throw passkeyDenied();
    const origins = options.origins.map(value => {
        const url = new URL(value);
        if (value !== url.origin || url.username || url.password || url.hostname !== rpId && !url.hostname.endsWith(`.${rpId}`) || url.protocol !== 'https:' && !(rpId === 'localhost' && url.protocol === 'http:')) throw passkeyDenied();
        return url.origin;
    });
    const ttl = options.challengeTtlMs ?? 120000, max = options.maxPending ?? 16, now = options.now ?? Date.now;
    if (!Number.isSafeInteger(ttl) || ttl < 1000 || ttl > 300000 || !Number.isSafeInteger(max) || max < 1 || max > 64 || typeof now !== 'function') throw passkeyDenied();
    const key = Buffer.from(options.bindingKey); let closed = false;
    const pending = new Set<Promise<unknown>>();
    const time = () => { const value = now(); if (!Number.isSafeInteger(value) || value < 0 || value > 8e15) throw passkeyDenied(); return value; };
    function context(account: AuthAccount, session: string) {
        const scope = Object.freeze({ tenant: account?.tenant, account: account?.account, rpId }); validatePasskeyScope(scope);
        if (!passkeyText(session)) throw passkeyDenied(); return scope;
    }
    const hmac = (scope: PasskeyScope, domain: string, value = '') => createHmac('sha256', key).update(JSON.stringify(['zeruxjs.auth.passkey.v1', domain, scope.rpId, scope.tenant, scope.account, value])).digest('base64url');
    function run<T>(fn: () => Promise<T>): Promise<T> {
        if (closed) return Promise.reject(new PasskeyError('PASSKEY_CLOSED'));
        if (pending.size >= max) return Promise.reject(new PasskeyError('PASSKEY_CAPACITY'));
        const work = fn().catch(cause => { if (cause instanceof PasskeyError) throw cause; throw new PasskeyError('PASSKEY_UNAVAILABLE', { cause }); });
        pending.add(work); void work.then(() => pending.delete(work), () => pending.delete(work)); return work;
    }
    async function credentials(scope: PasskeyScope) {
        const result = await store.list(scope);
        if (!Array.isArray(result) || result.length > 32) throw new PasskeyError('PASSKEY_UNAVAILABLE');
        try { for (const credential of result) validatePasskeyCredential(credential); } catch (cause) { throw new PasskeyError('PASSKEY_UNAVAILABLE', { cause }); }
        if (new Set(result.map(item => item.id)).size !== result.length) throw new PasskeyError('PASSKEY_UNAVAILABLE');
        if (new Set(result.map(item => item.userHandle)).size > 1) throw new PasskeyError('PASSKEY_UNAVAILABLE');
        return structuredClone(result);
    }
    async function take(scope: PasskeyScope, session: string, id: string, kind: PasskeyChallenge['kind']) {
        if (!passkeyBase64(id, 16, 16)) throw passkeyDenied();
        const current = time(), challenge = await store.takeChallenge(scope, id, session, kind, current);
        if (!challenge || challenge.id !== id || challenge.kind !== kind || challenge.session !== session || !passkeyBase64(challenge.challenge, 32, 32) || !passkeyBase64(challenge.userHandle, 64) || !passkeyText(challenge.epoch) || !Number.isSafeInteger(challenge.expiresAt) || challenge.expiresAt <= current || challenge.expiresAt - current > ttl) throw passkeyDenied();
        return structuredClone(challenge);
    }
    function notExpired(challenge: PasskeyChallenge) { if (time() >= challenge.expiresAt) throw passkeyDenied(); }
    return {
        /** Requires recent independent proof, before options are issued and again on completion. */
        beginRegistration(account: AuthAccount, session: string, userName: string) {
            return run(async () => {
                const scope = context(account, session);
                if (!passkeyText(userName) || await authorize(scope, 'enroll', session) !== true) throw passkeyDenied();
                const existing = await credentials(scope), lib = await backend();
                const userHandle = existing[0]?.userHandle ?? hmac(scope, 'user-handle'), challenge = randomBytes(32).toString('base64url');
                const output: PasskeyRegistrationOptions = await lib.generateRegistrationOptions({ rpName, rpID: rpId, userName, userID: new Uint8Array(Buffer.from(userHandle, 'base64url')), challenge: new Uint8Array(Buffer.from(challenge, 'base64url')), timeout: ttl, attestationType: 'none', supportedAlgorithmIDs: [-7, -257, -8], authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' }, excludeCredentials: existing.map(item => ({ id: item.id })) });
                const id = randomBytes(16).toString('base64url');
                await store.putChallenge(scope, { id, challenge, session, kind: 'registration', userHandle, expiresAt: time() + ttl }, time());
                return { id, options: output };
            });
        },
        completeRegistration(account: AuthAccount, session: string, id: string, response: unknown) {
            return run(async () => {
                const scope = context(account, session);
                if (await authorize(scope, 'enroll', session) !== true) throw passkeyDenied();
                const challenge = await take(scope, session, id, 'registration');
                const lib = await backend(); let verified;
                try {
                    const parsed = responseObject(response);
                    if (!passkeyBase64(parsed.response.attestationObject, 65536)) throw passkeyDenied();
                    verified = await lib.verifyRegistrationResponse({ response: parsed as Parameters<Library['verifyRegistrationResponse']>[0]['response'], expectedChallenge: challenge.challenge, expectedOrigin: origins, expectedRPID: rpId, requireUserPresence: true, requireUserVerification: true, supportedAlgorithmIDs: [-7, -257, -8] });
                } catch (cause) { throw new PasskeyError('PASSKEY_DENIED', { cause }); }
                if (!verified.verified || !verified.registrationInfo.userVerified || verified.registrationInfo.fmt !== 'none') throw passkeyDenied();
                const info = verified.registrationInfo, credential: PasskeyCredential = { id: info.credential.id, publicKey: Buffer.from(info.credential.publicKey).toString('base64url'), counter: info.credential.counter, revision: randomBytes(24).toString('base64url'), userHandle: challenge.userHandle, deviceType: info.credentialDeviceType, backedUp: info.credentialBackedUp };
                validatePasskeyCredential(credential); notExpired(challenge);
                if (await store.insert(scope, credential, challenge.epoch) !== true) throw passkeyDenied();
                return { credentialId: credential.id };
            });
        },
        /** Account-first step-up; deliberately no usernameless credential discovery. */
        beginAuthentication(account: AuthAccount, session: string) {
            return run(async () => {
                const scope = context(account, session), existing = await credentials(scope);
                if (!existing.length) throw passkeyDenied();
                const lib = await backend(), challenge = randomBytes(32).toString('base64url');
                const output: PasskeyAuthenticationOptions = await lib.generateAuthenticationOptions({ rpID: rpId, challenge: new Uint8Array(Buffer.from(challenge, 'base64url')), timeout: ttl, userVerification: 'required', allowCredentials: existing.map(item => ({ id: item.id })) });
                const id = randomBytes(16).toString('base64url');
                await store.putChallenge(scope, { id, challenge, session, kind: 'authentication', userHandle: existing[0].userHandle, expiresAt: time() + ttl }, time());
                return { id, options: output };
            });
        },
        completeAuthentication(account: AuthAccount, session: string, id: string, response: unknown): Promise<PasskeyIdentity> {
            return run(async () => {
                const scope = context(account, session), challenge = await take(scope, session, id, 'authentication');
                const lib = await backend(), existing = await credentials(scope); let parsed;
                try { parsed = responseObject(response); } catch (cause) { throw new PasskeyError('PASSKEY_DENIED', { cause }); }
                const credential = existing.find(item => item.id === parsed.id);
                if (!credential || credential.userHandle !== challenge.userHandle || parsed.response.userHandle != null && parsed.response.userHandle !== credential.userHandle || !passkeyBase64(parsed.response.authenticatorData, 4096) || !passkeyBase64(parsed.response.signature, 4096)) throw passkeyDenied();
                let verified;
                try { verified = await lib.verifyAuthenticationResponse({ response: parsed as Parameters<Library['verifyAuthenticationResponse']>[0]['response'], expectedChallenge: challenge.challenge, expectedOrigin: origins, expectedRPID: rpId, credential: { id: credential.id, publicKey: new Uint8Array(Buffer.from(credential.publicKey, 'base64url')), counter: credential.counter }, requireUserVerification: true }); }
                catch (cause) { throw new PasskeyError('PASSKEY_DENIED', { cause }); }
                notExpired(challenge);
                if (!verified.verified || !verified.authenticationInfo.userVerified || verified.authenticationInfo.credentialDeviceType !== credential.deviceType || await store.advance(scope, credential.id, credential.revision, verified.authenticationInfo.newCounter, challenge.epoch, verified.authenticationInfo.credentialBackedUp) !== true) throw passkeyDenied();
                return { tenant: scope.tenant, account: scope.account, method: 'webauthn', verifiedAt: time(), credentialId: credential.id };
            });
        },
        /** Reauthentication protects deletion. Host must ensure an independent recovery route remains. */
        removeCredential(account: AuthAccount, session: string, credentialId: string) {
            return run(async () => {
                const scope = context(account, session);
                if (!passkeyBase64(credentialId, 1024) || await authorize(scope, 'remove', session) !== true) throw passkeyDenied();
                return await store.remove(scope, credentialId) === true;
            });
        },
        /** Replace recovery set only after recent proof; plaintext is returned once, never persisted. */
        createRecoveryCodes(account: AuthAccount, session: string, lifetimeMs: number) {
            return run(async () => {
                const scope = context(account, session);
                if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1000 || lifetimeMs > 30 * 86400000 || await authorize(scope, 'recovery-enroll', session) !== true) throw passkeyDenied();
                const codes = Array.from({ length: 8 }, () => randomBytes(24).toString('base64url'));
                await store.replaceRecovery(scope, codes.map(code => hmac(scope, 'recovery', code)), time() + lifetimeMs); return codes;
            });
        },
        /** Lost-device proof consumes the entire set and atomically fences/removes every passkey ceremony. */
        recover(account: AuthAccount, session: string, code: string): Promise<PasskeyIdentity> {
            return run(async () => {
                const scope = context(account, session);
                if (!passkeyBase64(code, 24, 24) || await store.recover(scope, hmac(scope, 'recovery', code), time()) !== true) throw passkeyDenied();
                return { tenant: scope.tenant, account: scope.account, method: 'recovery', verifiedAt: time() };
            });
        },
        /** Stop admission, drain verifier/store work, erase the owned HMAC copy; never close the borrowed store. */
        async close() { closed = true; await Promise.allSettled([...pending]); key.fill(0); }
    };
}
