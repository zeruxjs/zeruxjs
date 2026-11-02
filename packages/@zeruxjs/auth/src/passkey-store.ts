import { randomBytes } from 'node:crypto';
import type { AuthAccount } from './shared-auth.js';

export interface PasskeyScope extends AuthAccount { rpId: string }
export interface PasskeyCredential {
    id: string; publicKey: string; counter: number; revision: string; userHandle: string;
    deviceType: 'singleDevice' | 'multiDevice'; backedUp: boolean;
}
export interface PasskeyChallenge {
    id: string; challenge: string; session: string; kind: 'registration' | 'authentication';
    expiresAt: number; userHandle: string; epoch: string;
}
/** Atomic shared storage, not a get/set cache. Every operation is account/tenant/RP scoped.
 * Implementations enforce <=32 credentials and <=8 live challenges/account, current reads,
 * RP-wide credential-ID uniqueness (across tenants/accounts), and unguessable nonreused revisions/epochs.
 * Credential insertion and advancement require the unchanged ceremony epoch.
 * Recovery must atomically consume the digest, delete ALL credentials/challenges/recovery codes and
 * rotate the epoch, fencing already-running ceremonies. No expiry eviction of credential state.
 * Host owns persistence, bounded acquisition/deadlines, encryption, backup and shutdown. */
export interface PasskeyStore {
    readonly capability: 'passkey-atomic-v1';
    list(scope: PasskeyScope): Promise<PasskeyCredential[]>;
    putChallenge(scope: PasskeyScope, challenge: Omit<PasskeyChallenge, 'epoch'>, now: number): Promise<void>;
    takeChallenge(scope: PasskeyScope, id: string, session: string, kind: PasskeyChallenge['kind'], now: number): Promise<PasskeyChallenge | null>;
    insert(scope: PasskeyScope, credential: PasskeyCredential, epoch: string): Promise<boolean>;
    advance(scope: PasskeyScope, id: string, revision: string, counter: number, epoch: string, backedUp: boolean): Promise<boolean>;
    remove(scope: PasskeyScope, id: string): Promise<boolean>;
    replaceRecovery(scope: PasskeyScope, digests: string[], expiresAt: number): Promise<void>;
    recover(scope: PasskeyScope, digest: string, now: number): Promise<boolean>;
}
export class PasskeyError extends Error {
    constructor(readonly code: 'PASSKEY_DENIED' | 'PASSKEY_UNAVAILABLE' | 'PASSKEY_CAPACITY' | 'PASSKEY_CLOSED', options?: ErrorOptions) {
        super(code, options); this.name = 'PasskeyError';
    }
}
export const passkeyDenied = () => new PasskeyError('PASSKEY_DENIED');
export const passkeyText = (value: unknown, max = 128): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
export function passkeyBase64(value: unknown, max: number, min = 1): value is string {
    if (typeof value !== 'string' || value.length > Math.ceil(max * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
    const raw = Buffer.from(value, 'base64url'); return raw.length >= min && raw.length <= max && raw.toString('base64url') === value;
}
export function validatePasskeyScope(scope: PasskeyScope) {
    if (!scope || !passkeyText(scope.tenant) || !passkeyText(scope.account) || !passkeyText(scope.rpId, 253) || !/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(scope.rpId)) throw passkeyDenied();
}
export function validatePasskeyCredential(value: PasskeyCredential) {
    if (!value || !passkeyBase64(value.id, 1024) || !passkeyBase64(value.publicKey, 4096) || !passkeyBase64(value.userHandle, 64) || !passkeyText(value.revision) || !Number.isSafeInteger(value.counter) || value.counter < 0 || value.counter > 0xffffffff || !['singleDevice', 'multiDevice'].includes(value.deviceType) || typeof value.backedUp !== 'boolean') throw passkeyDenied();
}
const revision = () => randomBytes(24).toString('base64url');
/** Process-local bounded reference. Do not use as distributed persistence or clear while identities are active. */
export function createMemoryPasskeyStore(options: { maxAccounts?: number } = {}): PasskeyStore & { clear(): void; readonly size: number } {
    const max = options.maxAccounts ?? 1000;
    if (!Number.isSafeInteger(max) || max < 1 || max > 10000) throw passkeyDenied();
    type State = { epoch: string; credentials: PasskeyCredential[]; challenges: PasskeyChallenge[]; recovery: string[]; recoveryExpires: number };
    const accounts = new Map<string, State>();
    const key = (scope: PasskeyScope) => { validatePasskeyScope(scope); return JSON.stringify([scope.rpId, scope.tenant, scope.account]); };
    function state(scope: PasskeyScope): State {
        const id = key(scope); let entry = accounts.get(id);
        if (!entry) { if (accounts.size >= max) throw new PasskeyError('PASSKEY_CAPACITY'); entry = { epoch: revision(), credentials: [], challenges: [], recovery: [], recoveryExpires: 0 }; accounts.set(id, entry); }
        return entry;
    }
    return {
        capability: 'passkey-atomic-v1',
        async list(scope) { return structuredClone(accounts.get(key(scope))?.credentials ?? []); },
        async putChallenge(scope, challenge, now) {
            if (!challenge || !passkeyBase64(challenge.id, 16, 16) || !passkeyBase64(challenge.challenge, 32, 32) || !passkeyBase64(challenge.userHandle, 64) || !passkeyText(challenge.session) || !['registration', 'authentication'].includes(challenge.kind) || !Number.isSafeInteger(now) || !Number.isSafeInteger(challenge.expiresAt) || challenge.expiresAt <= now || challenge.expiresAt - now > 300000) throw passkeyDenied();
            const entry = state(scope); entry.challenges = entry.challenges.filter(item => item.expiresAt > now);
            if (entry.challenges.length >= 8 || entry.challenges.some(item => item.id === challenge.id)) throw new PasskeyError('PASSKEY_CAPACITY');
            entry.challenges.push({ ...structuredClone(challenge), epoch: entry.epoch });
        },
        async takeChallenge(scope, id, session, kind, now) {
            if (!passkeyBase64(id, 16, 16) || !passkeyText(session) || !['registration', 'authentication'].includes(kind) || !Number.isSafeInteger(now) || now < 0) throw passkeyDenied();
            const entry = accounts.get(key(scope)); if (!entry) return null;
            entry.challenges = entry.challenges.filter(item => item.expiresAt > now);
            const item = entry.challenges.find(item => item.id === id && item.session === session && item.kind === kind);
            if (!item) return null;
            entry.challenges = entry.challenges.filter(value => value.id !== id); return structuredClone(item);
        },
        async insert(scope, credential, epoch) {
            validatePasskeyCredential(credential); if (!passkeyText(epoch)) throw passkeyDenied(); const entry = state(scope);
            if (entry.epoch !== epoch || entry.credentials.some(item => item.userHandle !== credential.userHandle)) return false;
            if (entry.credentials.length >= 32) throw new PasskeyError('PASSKEY_CAPACITY');
            for (const [id, other] of accounts) if (JSON.parse(id)[0] === scope.rpId && other.credentials.some(item => item.id === credential.id)) return false;
            entry.credentials.push(structuredClone(credential)); return true;
        },
        async advance(scope, id, expected, counter, epoch, backedUp) {
            if (!passkeyBase64(id, 1024) || !passkeyText(expected) || !passkeyText(epoch) || typeof backedUp !== 'boolean' || !Number.isSafeInteger(counter) || counter < 0 || counter > 0xffffffff) throw passkeyDenied();
            const entry = accounts.get(key(scope)), item = entry?.credentials.find(item => item.id === id);
            if (!entry || !item || entry.epoch !== epoch || item.revision !== expected || (item.counter !== 0 || counter !== 0) && counter <= item.counter) return false;
            item.counter = counter; item.backedUp = backedUp; item.revision = revision(); return true;
        },
        async remove(scope, id) {
            if (!passkeyBase64(id, 1024)) throw passkeyDenied();
            const entry = accounts.get(key(scope)); if (!entry) return false;
            const before = entry.credentials.length; entry.credentials = entry.credentials.filter(item => item.id !== id);
            // Fence all in-flight ceremonies, including a removed credential's assertion.
            entry.epoch = revision(); entry.challenges = []; return entry.credentials.length !== before;
        },
        async replaceRecovery(scope, digests, expiresAt) {
            if (!Array.isArray(digests) || digests.length < 1 || digests.length > 10 || digests.some(value => !passkeyBase64(value, 32, 32)) || new Set(digests).size !== digests.length || !Number.isSafeInteger(expiresAt) || expiresAt < 0) throw passkeyDenied();
            const entry = state(scope); entry.recovery = [...digests]; entry.recoveryExpires = expiresAt;
        },
        async recover(scope, digest, now) {
            if (!passkeyBase64(digest, 32, 32) || !Number.isSafeInteger(now) || now < 0) throw passkeyDenied();
            const entry = accounts.get(key(scope));
            if (!entry || entry.recoveryExpires <= now || !entry.recovery.includes(digest)) return false;
            entry.credentials = []; entry.challenges = []; entry.recovery = []; entry.recoveryExpires = 0; entry.epoch = revision(); return true;
        },
        clear() { accounts.clear(); }, get size() { return accounts.size; }
    };
}
