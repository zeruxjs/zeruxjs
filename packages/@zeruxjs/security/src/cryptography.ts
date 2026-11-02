import crypto from 'node:crypto';
export type DigestAlgorithm = 'sha256' | 'sha384' | 'sha512';
export interface RecordKey { readonly id: string; readonly key: Uint8Array }
export interface KeyringOptions {
    readonly current: RecordKey;
    readonly previous?: readonly RecordKey[];
    readonly maxBytes?: number;
}
export interface EncryptionKeyringOptions extends KeyringOptions { readonly algorithm?: 'aes-256-gcm' }
export interface MessageAuthenticatorOptions extends KeyringOptions { readonly algorithm?: 'hmac-sha256' }
export interface EncryptedRecord { readonly v: 1; readonly alg: 'A256GCM'; readonly kid: string; readonly iv: string; readonly tag: string; readonly ciphertext: string }
export interface MessageAuthentication { readonly v: 1; readonly alg: 'HS256'; readonly kid: string; readonly tag: string }
/** Generic authentication rejection; no key, plaintext, record or reason oracle. */
export class SecurityRecordError extends Error {
    constructor() { super('Invalid or unauthenticated security record'); this.name = 'SecurityRecordError'; }
}
/** Native backend failures remain errors, with trusted server-side causes only. */
export class SecurityCryptoError extends Error {
    constructor(cause: unknown) { super('Node crypto operation failed', { cause }); this.name = 'SecurityCryptoError'; }
}
const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
function bytes(value: unknown, maximum: number): Buffer {
    if (typeof value !== 'string' && !(value instanceof Uint8Array)) throw new TypeError('Expected text or byte input');
    if (typeof value === 'string' && value.length > maximum) throw new RangeError('Crypto input exceeds byte limit');
    const size = typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : value.byteLength;
    if (size > maximum) throw new RangeError('Crypto input exceeds byte limit');
    return typeof value === 'string' ? Buffer.from(value, 'utf8') : Buffer.from(value);
}
function validateContext(context: unknown): asserts context is string {
    if (typeof context !== 'string' || !context || context.length > 1024 || Buffer.byteLength(context) > 1024) throw new TypeError('A bounded nonempty security context is required');
}
function setup(options: KeyringOptions) {
    if (!options || typeof options !== 'object') throw new TypeError('Invalid keyring options');
    const maximum = options.maxBytes === undefined ? 1024 * 1024 : options.maxBytes;
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > 16 * 1024 * 1024) throw new RangeError('Invalid crypto byte limit');
    if (options.previous !== undefined && (!Array.isArray(options.previous) || options.previous.length > 4)) throw new TypeError('At most four previous keys are supported');
    const keys = new Map<string, Buffer>();
    try {
        for (const entry of [options.current, ...(options.previous ?? [])]) {
            if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !idPattern.test(entry.id) || keys.has(entry.id)) throw new TypeError('Invalid or duplicate key identifier');
            if (!(entry.key instanceof Uint8Array) || entry.key.byteLength !== 32) throw new TypeError('Security keys must contain exactly 32 bytes');
            keys.set(entry.id, Buffer.from(entry.key));
        }
    } catch (error) { for (const key of keys.values()) key.fill(0); throw error; }
    const current = options.current.id;
    let destroyed = false;
    return {
        maximum, current, keys,
        check() { if (destroyed) throw new Error('Security keyring is destroyed'); },
        destroy() { for (const key of keys.values()) key.fill(0); keys.clear(); destroyed = true; }
    };
}
function decode(value: unknown, max: number, length?: number): Buffer | undefined {
    if (typeof value !== 'string' || value.length > Math.ceil(max * 4 / 3) || !/^[A-Za-z0-9_-]*$/.test(value)) return;
    const result = Buffer.from(value, 'base64url');
    if (result.byteLength > max || (length !== undefined && result.byteLength !== length) || result.toString('base64url') !== value) return;
    return result;
}
function fields(record: unknown, names: readonly string[]): Record<string, unknown> | undefined {
    try {
        if (!record || typeof record !== 'object' || Array.isArray(record)) return;
        const descriptors = Object.getOwnPropertyDescriptors(record);
        if (Object.keys(descriptors).length !== names.length || names.some(name => !Object.hasOwn(descriptors, name) || !Object.hasOwn(descriptors[name], 'value'))) return;
        return Object.fromEntries(names.map(name => [name, descriptors[name].value]));
    } catch { return; } // Treat hostile reflective objects like malformed records, without exposing their errors.
}
function aad(domain: string, v: number, alg: string, kid: string, context: string): Buffer {
    return Buffer.from(JSON.stringify([domain, v, alg, kid, context]));
}

/** AES-256-GCM only. New records use fresh 12-byte random IVs and 16-byte tags.
 * Context and v/alg/kid are authenticated. Never returns unauthenticated plaintext.
 * Retired keys decrypt only; caller owns key distribution, durable storage and auth.
 */
export function createEncryptionKeyring(options: EncryptionKeyringOptions) {
    if (options?.algorithm !== undefined && options.algorithm !== 'aes-256-gcm') throw new TypeError('Unsupported encryption algorithm');
    const ring = setup(options);
    return {
        encrypt(plaintext: string | Uint8Array, context: string): EncryptedRecord {
            ring.check(); validateContext(context);
            const input = bytes(plaintext, ring.maximum);
            try {
                const iv = crypto.randomBytes(12);
                const cipher = crypto.createCipheriv('aes-256-gcm', ring.keys.get(ring.current)!, iv, { authTagLength: 16 });
                cipher.setAAD(aad('zeruxjs.security.record', 1, 'A256GCM', ring.current, context));
                const encrypted = Buffer.concat([cipher.update(input), cipher.final()]);
                return { v: 1, alg: 'A256GCM', kid: ring.current, iv: iv.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: encrypted.toString('base64url') };
            } catch (cause) { throw new SecurityCryptoError(cause); }
            finally { input.fill(0); }
        },
        decrypt(record: unknown, context: string): Buffer {
            ring.check(); validateContext(context);
            const data = fields(record, ['v', 'alg', 'kid', 'iv', 'tag', 'ciphertext']);
            if (!data || data.v !== 1 || data.alg !== 'A256GCM' || typeof data.kid !== 'string' || !idPattern.test(data.kid)) throw new SecurityRecordError();
            const key = ring.keys.get(data.kid);
            const iv = decode(data.iv, 12, 12), tag = decode(data.tag, 16, 16), ciphertext = decode(data.ciphertext, ring.maximum);
            if (!key || !iv || !tag || !ciphertext) throw new SecurityRecordError();
            let decipher: crypto.DecipherGCM;
            try { decipher = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 }); }
            catch (cause) { throw new SecurityCryptoError(cause); }
            let pending: Buffer | undefined;
            try {
                decipher.setAAD(aad('zeruxjs.security.record', 1, 'A256GCM', data.kid, context));
                decipher.setAuthTag(tag);
                pending = decipher.update(ciphertext);
                return Buffer.concat([pending, decipher.final()]);
            } catch { throw new SecurityRecordError(); }
            finally { pending?.fill(0); }
        },
        destroy: ring.destroy
    };
}

/** Native HMAC-SHA-256 authentication, not encryption or public-key signatures. */
export function createMessageAuthenticator(options: MessageAuthenticatorOptions) {
    if (options?.algorithm !== undefined && options.algorithm !== 'hmac-sha256') throw new TypeError('Unsupported authentication algorithm');
    const ring = setup(options);
    function tag(message: string | Uint8Array, context: string, kid: string): Buffer {
        validateContext(context); const input = bytes(message, ring.maximum);
        try { return crypto.createHmac('sha256', ring.keys.get(kid)!).update(aad('zeruxjs.security.mac', 1, 'HS256', kid, context)).update(input).digest(); }
        catch (cause) { throw new SecurityCryptoError(cause); }
        finally { input.fill(0); }
    }
    return {
        sign(message: string | Uint8Array, context: string): MessageAuthentication {
            ring.check(); return { v: 1, alg: 'HS256', kid: ring.current, tag: tag(message, context, ring.current).toString('base64url') };
        },
        verify(message: string | Uint8Array, record: unknown, context: string): boolean {
            ring.check(); validateContext(context);
            const data = fields(record, ['v', 'alg', 'kid', 'tag']);
            if (!data || data.v !== 1 || data.alg !== 'HS256' || typeof data.kid !== 'string' || !idPattern.test(data.kid) || !ring.keys.has(data.kid)) return false;
            const actual = decode(data.tag, 32, 32);
            if (!actual) return false;
            const expected = tag(message, context, data.kid);
            return crypto.timingSafeEqual(actual, expected);
        },
        destroy: ring.destroy
    };
}

/** Allowlisted data digest. Not a password hash, signature, MAC or checksum. */
export function hashData(input: string | Uint8Array, algorithm: DigestAlgorithm = 'sha256'): string {
    if (!['sha256', 'sha384', 'sha512'].includes(algorithm)) throw new TypeError('Unsupported digest algorithm');
    const data = bytes(input, 16 * 1024 * 1024);
    try { return crypto.createHash(algorithm).update(data).digest('hex'); }
    catch (cause) { throw new SecurityCryptoError(cause); }
    finally { data.fill(0); }
}
/** Constant-time equal-length native byte comparison; length checks are observable.
 * This alone does not make an entire request, password check or application constant-time.
 */
export function timingSafeEqualBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.byteLength > 1024 * 1024 || right.byteLength > 1024 * 1024) return false;
    return left.byteLength === right.byteLength && crypto.timingSafeEqual(left, right);
}
