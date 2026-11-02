import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { generateTotp, type TotpOptions } from './totp.js';

export interface AuthAccount { tenant: string; account: string }
export interface AuthSession { id: string; device: string; createdAt: number; expiresAt: number; digest: string; kid: string; scopes: string[] }
export interface AuthChallenge { id: string; purpose: 'reset' | 'otp' | 'magic'; digest: string; kid: string; expiresAt: number; attempts: number; maxAttempts: number }
export interface AuthAccountState { sessions: AuthSession[]; challenges: AuthChallenge[]; steps: Record<string, number> }
export interface AuthSnapshot { revision: string; value: AuthAccountState }
/** Shared adapters MUST provide linearizable CAS, including null=create-if-absent, with durable expiry.
 * Revisions are opaque and must never be reused (including after deletion). Reads must be current.
 * expiresAt is Unix milliseconds; no account data may survive that deadline without a subsequent CAS.
 * Never emulate this contract using ordinary cache get/set or approximate affected counts. */
export interface AuthPersistence {
    readonly capability: 'auth-cas-v1';
    read(key: string): Promise<AuthSnapshot | null>;
    compareAndSwap(key: string, revision: string | null, value: AuthAccountState, expiresAt: number): Promise<boolean>;
}
export class AuthStateError extends Error {
    constructor(readonly code: 'AUTH_INVALID' | 'AUTH_UNAVAILABLE' | 'AUTH_CAPACITY' | 'AUTH_CLOSED', options?: ErrorOptions) {
        super(code, options); this.name = 'AuthStateError';
    }
}
const invalid = () => new AuthStateError('AUTH_INVALID');
const text = (value: unknown, max = 128): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
const integer = (value: number, min: number, max: number) => Number.isSafeInteger(value) && value >= min && value <= max;
const empty = (): AuthAccountState => ({ sessions: [], challenges: [], steps: Object.create(null) });

function validateState(state: AuthAccountState): void {
    if (!state || typeof state !== 'object' || !Array.isArray(state.sessions) || state.sessions.length > 64 || !Array.isArray(state.challenges) || state.challenges.length > 32 || !state.steps || typeof state.steps !== 'object' || Array.isArray(state.steps) || Object.keys(state.steps).length > 16) throw invalid();
    const fields = (value: object, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
    if (!fields(state, ['sessions', 'challenges', 'steps'])) throw invalid();
    const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{22}$/.test(value);
    const hash = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
    const meta = (value: AuthSession | AuthChallenge) => id(value.id) && hash(value.digest) && typeof value.kid === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value.kid) && integer(value.expiresAt, 0, 8e15);
    if (new Set(state.sessions.map(v => v.id)).size !== state.sessions.length || new Set(state.challenges.map(v => v.id)).size !== state.challenges.length) throw invalid();
    for (const item of state.sessions) if (!meta(item) || !fields(item, ['id', 'device', 'createdAt', 'expiresAt', 'digest', 'kid', 'scopes']) || !text(item.device, 100) || !integer(item.createdAt, 0, item.expiresAt) || !Array.isArray(item.scopes) || item.scopes.length > 32 || item.scopes.some(s => typeof s !== 'string' || !/^[A-Za-z0-9:_-]{1,100}$/.test(s))) throw invalid();
    for (const item of state.challenges) if (!meta(item) || !fields(item, ['id', 'purpose', 'digest', 'kid', 'expiresAt', 'attempts', 'maxAttempts']) || !['reset', 'otp', 'magic'].includes(item.purpose) || !integer(item.maxAttempts, 1, 10) || !integer(item.attempts, 0, item.maxAttempts - 1)) throw invalid();
    for (const [key, step] of Object.entries(state.steps)) if (!hash(key) || !integer(step, 0, Number.MAX_SAFE_INTEGER)) throw invalid();
    if (Buffer.byteLength(JSON.stringify(state)) > 131072) throw invalid();
}

/** Bounded process-local reference adapter; sharing this object is NOT cross-process persistence. */
export function createMemoryAuthPersistence(options: { maxAccounts?: number; now?: () => number } = {}): AuthPersistence & { clear(): void; readonly size: number } {
    const max = options.maxAccounts ?? 1000, now = options.now ?? Date.now;
    if (!integer(max, 1, 100000)) throw invalid();
    const records = new Map<string, { snapshot: AuthSnapshot; expiresAt: number }>();
    function prune() { for (const [key, item] of records) if (item.expiresAt <= now()) records.delete(key); }
    return {
        capability: 'auth-cas-v1',
        async read(key) { prune(); return structuredClone(records.get(key)?.snapshot ?? null); },
        async compareAndSwap(key, revision, value, expiresAt) {
            if (!/^[A-Za-z0-9_-]{43}$/.test(key) || !Number.isSafeInteger(expiresAt) || expiresAt <= now() || Buffer.byteLength(JSON.stringify(value)) > 131072) throw invalid();
            validateState(value);
            prune();
            if ((records.get(key)?.snapshot.revision ?? null) !== revision) return false;
            if (!records.has(key) && records.size >= max) throw new AuthStateError('AUTH_CAPACITY');
            records.set(key, { snapshot: { revision: randomBytes(24).toString('base64url'), value: structuredClone(value) }, expiresAt }); return true;
        },
        clear() { records.clear(); }, get size() { prune(); return records.size; }
    };
}

export interface SharedAuthOptions {
    store: AuthPersistence;
    /** Stable tenant/account index secret, separate from rotating token keys. Changing it invalidates all state. */
    indexKey: Uint8Array;
    keys: readonly { id: string; key: Uint8Array }[];
    activeKeyId: string;
    now?: () => number;
    maxPending?: number;
    /** Must check a recent independent authentication for this exact account and action. */
    authorizeFresh: (account: Readonly<AuthAccount>, action: 'revoke-one' | 'revoke-all' | 'revoke-challenges' | 'rotate') => Promise<boolean>;
}
/** Opaque sessions and purpose-bound one-use challenges. No cookies, network, global handlers or store ownership. */
export function createSharedAuth(options: SharedAuthOptions) {
    if (!options || options.store?.capability !== 'auth-cas-v1' || typeof options.store.read !== 'function' || typeof options.store.compareAndSwap !== 'function' || typeof options.authorizeFresh !== 'function' || !(options.indexKey instanceof Uint8Array) || options.indexKey.length !== 32 || !Array.isArray(options.keys) || options.keys.length < 1 || options.keys.length > 8) throw invalid();
    const store = options.store, authorize = options.authorizeFresh, now = options.now ?? Date.now;
    const index = Buffer.from(options.indexKey), keys = new Map<string, Buffer>();
    try {
        for (const key of options.keys) {
            if (!/^[A-Za-z0-9_-]{1,32}$/.test(key.id) || keys.has(key.id) || !(key.key instanceof Uint8Array) || key.key.length !== 32) throw invalid();
            keys.set(key.id, Buffer.from(key.key));
        }
        if (!keys.has(options.activeKeyId) || !integer(options.maxPending ?? 32, 1, 256) || typeof now !== 'function') throw invalid();
    } catch (error) { index.fill(0); for (const key of keys.values()) key.fill(0); throw error; }
    const active = options.activeKeyId, maxPending = options.maxPending ?? 32;
    let closed = false;
    const pending = new Set<Promise<unknown>>();
    const stamp = () => { const time = now(); if (!integer(time, 0, 8e15)) throw invalid(); return time; };
    function accountKey(account: AuthAccount) {
        if (!account || !text(account.tenant) || !text(account.account)) throw invalid();
        return createHmac('sha256', index).update(JSON.stringify(['account', account.tenant, account.account])).digest('base64url');
    }
    const digest = (kid: string, key: string, purpose: string, raw: string) => createHmac('sha256', keys.get(kid)!).update(JSON.stringify(['zeruxjs.auth.record.v1', key, purpose, raw])).digest('base64url');
    function matches(kid: string, key: string, purpose: string, raw: string, expected: string) {
        if (!keys.has(kid) || !/^[A-Za-z0-9_-]{43}$/.test(expected)) return false;
        return timingSafeEqual(Buffer.from(digest(kid, key, purpose, raw)), Buffer.from(expected));
    }
    function run<T>(fn: () => Promise<T>): Promise<T> {
        if (closed) return Promise.reject(new AuthStateError('AUTH_CLOSED'));
        if (pending.size >= maxPending) return Promise.reject(new AuthStateError('AUTH_CAPACITY'));
        const task = fn().catch(error => { if (error instanceof AuthStateError) throw error; throw new AuthStateError('AUTH_UNAVAILABLE', { cause: error }); });
        pending.add(task); void task.then(() => pending.delete(task), () => pending.delete(task)); return task;
    }
    async function readSnapshot(key: string): Promise<AuthSnapshot | null> {
        const snapshot = await store.read(key);
        if (snapshot === null) return null;
        try {
            if (!snapshot || !text(snapshot.revision, 256)) throw invalid();
            validateState(snapshot.value);
        } catch (cause) { throw new AuthStateError('AUTH_UNAVAILABLE', { cause }); }
        return structuredClone(snapshot);
    }
    // Transition callbacks are pure: CAS conflicts never replay external side effects.
    async function change<T>(key: string, transition: (state: AuthAccountState, time: number) => T): Promise<T> {
        for (let attempt = 0; attempt < 8; attempt++) {
            const snapshot = await readSnapshot(key), time = stamp();
            const state = snapshot ? structuredClone(snapshot.value) : empty();
            try { validateState(state); } catch (cause) { throw new AuthStateError('AUTH_UNAVAILABLE', { cause }); }
            state.sessions = state.sessions.filter(item => item.expiresAt > time);
            state.challenges = state.challenges.filter(item => item.expiresAt > time);
            const result = transition(state, time);
            // Replay steps survive until at least their accepted step is outside the maximum allowed window.
            const expiry = Math.max(time + 3600000, ...state.sessions.map(item => item.expiresAt), ...state.challenges.map(item => item.expiresAt));
            const written = await store.compareAndSwap(key, snapshot?.revision ?? null, state, expiry);
            if (written === true) return result;
            if (written !== false) throw new AuthStateError('AUTH_UNAVAILABLE');
        }
        throw new AuthStateError('AUTH_UNAVAILABLE');
    }
    const token = () => ({ id: randomBytes(16).toString('base64url'), secret: randomBytes(32).toString('base64url') });
    function parse(raw: string) { return typeof raw === 'string' && raw.length < 128 ? /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(raw) : null; }
    function scopes(value: readonly string[]) {
        if (!Array.isArray(value) || value.length > 32 || value.some(s => typeof s !== 'string' || !/^[A-Za-z0-9:_-]{1,100}$/.test(s))) throw invalid();
        return [...new Set(value)]; // Exact scopes only; no wildcard expansion.
    }
    function session(key: string, device: string, permissions: string[], ttlMs: number, time: number) {
        const item = token(), raw = `${item.id}.${item.secret}`;
        return { raw, record: { id: item.id, device, scopes: permissions, createdAt: time, expiresAt: time + ttlMs, kid: active, digest: digest(active, key, 'session', raw) } };
    }
    const publicSession = (record: AuthSession) => ({ id: record.id, device: record.device, createdAt: record.createdAt, expiresAt: record.expiresAt, scopes: [...record.scopes] });
    return {
        /** Issue after host authentication; returns the only plaintext bearer copy plus cloned metadata. */
        issueSession(account: AuthAccount, input: { device: string; scopes: readonly string[]; ttlMs: number }) {
            return run(async () => {
                const key = accountKey(account), permissions = scopes(input.scopes);
                const { device, ttlMs } = input;
                if (!text(device, 100) || !integer(ttlMs, 1, 30 * 86400000)) throw invalid();
                return change(key, (state, time) => {
                    if (state.sessions.length >= 64) throw new AuthStateError('AUTH_CAPACITY');
                    const issued = session(key, device, permissions, ttlMs, time); state.sessions.push(issued.record);
                    return { token: issued.raw, session: publicSession(issued.record) };
                });
            });
        },
        /** Current shared-state lookup; exact scope check, null for denied/expired credentials. */
        verifySession(account: AuthAccount, raw: string, scope?: string) {
            return run(async () => {
                const key = accountKey(account), parsed = parse(raw);
                if (scope !== undefined) scopes([scope]);
                if (!parsed) return null;
                const snapshot = await readSnapshot(key), time = stamp();
                const found = snapshot?.value.sessions.find(item => item.id === parsed[1]);
                return found && found.expiresAt > time && matches(found.kid, key, 'session', raw, found.digest) && (scope === undefined || found.scopes.includes(scope)) ? publicSession(found) : null;
            });
        },
        /** Freshly authorized device/session inventory, excluding token digests and key IDs. */
        inventory(account: AuthAccount) {
            return run(async () => {
                const identity = Object.freeze({ ...account }); const key = accountKey(identity);
                if (await authorize(identity, 'revoke-one') !== true) throw invalid();
                const snapshot = await readSnapshot(key), time = stamp();
                return (snapshot?.value.sessions ?? []).filter(item => item.expiresAt > time && keys.has(item.kid)).map(publicSession);
            });
        },
        /** Freshly authorized atomic revoke-one or revoke-all; returns removed active session count. */
        revoke(account: AuthAccount, id?: string) {
            return run(async () => {
                const identity = Object.freeze({ ...account }), key = accountKey(identity);
                if (id !== undefined && !/^[A-Za-z0-9_-]{22}$/.test(id)) throw invalid();
                if (await authorize(identity, id === undefined ? 'revoke-all' : 'revoke-one') !== true) throw invalid();
                return change(key, state => { const before = state.sessions.length; state.sessions = id === undefined ? [] : state.sessions.filter(item => item.id !== id); return before - state.sessions.length; });
            });
        },
        /** Freshly authorized invalidation for one purpose or all recovery challenges. */
        revokeChallenges(account: AuthAccount, purpose?: AuthChallenge['purpose']) {
            return run(async () => {
                const identity = Object.freeze({ ...account }), key = accountKey(identity);
                if (purpose !== undefined && !['reset', 'otp', 'magic'].includes(purpose)) throw invalid();
                if (await authorize(identity, 'revoke-challenges') !== true) throw invalid();
                return change(key, state => {
                    const before = state.challenges.length;
                    state.challenges = purpose === undefined ? [] : state.challenges.filter(item => item.purpose !== purpose);
                    return before - state.challenges.length;
                });
            });
        },
        /** Replace the current bearer atomically after fresh authorization; host approves new exact scopes. */
        rotateSession(account: AuthAccount, raw: string, permissions: readonly string[]) {
            return run(async () => {
                const identity = Object.freeze({ ...account }), key = accountKey(identity), parsed = parse(raw), granted = scopes(permissions);
                if (!parsed || await authorize(identity, 'rotate') !== true) throw invalid();
                return change(key, (state, time) => {
                    const previous = state.sessions.find(item => item.id === parsed[1]);
                    if (!previous || !matches(previous.kid, key, 'session', raw, previous.digest)) throw invalid();
                    const issued = session(key, previous.device, granted, previous.expiresAt - time, time);
                    state.sessions = state.sessions.filter(item => item.id !== previous.id); state.sessions.push(issued.record);
                    return { token: issued.raw, session: publicSession(issued.record) };
                });
            });
        },
        /** Create a purpose/account-bound challenge; caller privately delivers its returned secret. */
        issueChallenge(account: AuthAccount, input: { purpose: AuthChallenge['purpose']; ttlMs: number; maxAttempts?: number }) {
            return run(async () => {
                const key = accountKey(account), maxAttempts = input.maxAttempts ?? 5;
                const { purpose, ttlMs } = input;
                if (!['reset', 'otp', 'magic'].includes(purpose) || !integer(ttlMs, 1, 900000) || !integer(maxAttempts, 1, 10)) throw invalid();
                const item = token(), secret = purpose === 'otp' ? String(randomInt(0, 1000000)).padStart(6, '0') : item.secret;
                return change(key, (state, time) => {
                    if (state.challenges.length >= 32) throw new AuthStateError('AUTH_CAPACITY');
                    state.challenges.push({ id: item.id, purpose, kid: active, digest: digest(active, key, purpose, `${item.id}.${secret}`), expiresAt: time + ttlMs, attempts: 0, maxAttempts });
                    return { id: item.id, secret, expiresAt: time + ttlMs };
                });
            });
        },
        /** Atomically consume once or record a failed attempt; false has no account-existence diagnostic. */
        consumeChallenge(account: AuthAccount, input: { purpose: AuthChallenge['purpose']; id: string; secret: string }) {
            return run(async () => {
                const key = accountKey(account);
                const { purpose, id, secret } = input;
                if (!['reset', 'otp', 'magic'].includes(purpose) || !/^[A-Za-z0-9_-]{22}$/.test(id) || !text(secret, 128)) return false;
                return change(key, state => {
                    const item = state.challenges.find(item => item.id === id && item.purpose === purpose);
                    if (!item) return false;
                    item.attempts++;
                    const accepted = matches(item.kid, key, purpose, `${id}.${secret}`, item.digest);
                    if (accepted || item.attempts >= item.maxAttempts) state.challenges = state.challenges.filter(record => record.id !== item.id);
                    return accepted;
                });
            });
        },
        /** Validate host-enrolled TOTP parameters and atomically advance its accepted step. Requires edge admission. */
        consumeTotp(account: AuthAccount, credentialId: string, code: string, secret: string, input: Omit<TotpOptions, 'now'> & { window?: number } = {}) {
            return run(async () => {
                const key = accountKey(account), time = stamp(), period = input.period ?? 30, window = input.window ?? 1;
                if (!text(credentialId) || !integer(window, 0, 5) || !integer(period, 10, 300) || ![6, 8].includes(input.digits ?? 6) || !['sha1', 'sha256', 'sha512'].includes(input.algorithm ?? 'sha1') || typeof secret !== 'string' || secret.length > 128) throw invalid();
                if (typeof code !== 'string' || !new RegExp(`^[0-9]{${input.digits ?? 6}}$`).test(code)) return false;
                const counter = Math.floor(time / (period * 1000)); let matched = -1;
                for (let step = Math.max(0, counter - window); step <= counter + window; step++) {
                    const candidate = generateTotp(secret, { ...input, now: step * period * 1000 });
                    if (timingSafeEqual(Buffer.from(candidate), Buffer.from(code))) matched = step;
                }
                if (matched < 0) return false;
                const credential = createHmac('sha256', index).update(JSON.stringify(['totp', credentialId])).digest('base64url');
                return change(key, (state, current) => {
                    if (Math.abs(Math.floor(current / (period * 1000)) - matched) > window) return false;
                    if (matched <= (Object.hasOwn(state.steps, credential) ? state.steps[credential] : -1)) return false;
                    if (!Object.hasOwn(state.steps, credential) && Object.keys(state.steps).length >= 16) throw new AuthStateError('AUTH_CAPACITY');
                    state.steps[credential] = matched; return true;
                });
            });
        },
        /** Stop admission, drain outstanding persistence calls, then erase owned key copies. Store remains host-owned. */
        async close() { closed = true; await Promise.allSettled([...pending]); index.fill(0); for (const key of keys.values()) key.fill(0); keys.clear(); }
    };
}

/** Strict opaque-session cookie boundary. Reject duplicates, encoding and malformed headers; never log the header. */
export function readAuthSessionCookie(header: string | null, name = '__Host-session'): string | null {
    if (typeof name !== 'string' || !/^(__Host-|__Secure-)?[A-Za-z_][A-Za-z0-9_-]{0,99}$/.test(name)) throw invalid();
    if (header === null) return null;
    if (typeof header !== 'string' || Buffer.byteLength(header) > 8192 || /[^\x20-\x7e]/.test(header)) return null;
    let found: string | null = null;
    for (const part of header.split(';')) {
        const pair = part.trim(), at = pair.indexOf('=');
        if (at < 1) return null;
        if (pair.slice(0, at) !== name) continue;
        if (found !== null) return null;
        const value = pair.slice(at + 1);
        if (!/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(value)) return null;
        found = value;
    }
    return found;
}

/** Secure host-only session cookie; HTTPS, path=/, no Domain and no cross-site delivery. Expiry stays server-authoritative. */
export function authSessionCookie(token: string, maxAgeSeconds: number): string {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/.test(token) || !integer(maxAgeSeconds, 0, 30 * 86400)) throw invalid();
    return `__Host-session=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}`;
}
