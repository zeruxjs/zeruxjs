import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function generateTotpSecret(bytes = 20): string {
    if (!Number.isSafeInteger(bytes) || bytes < 16 || bytes > 64) throw new RangeError("Invalid TOTP secret length");
    let bits = 0, value = 0, output = "";
    for (const byte of randomBytes(bytes)) {
        value = (value << 8) | byte; bits += 8;
        while (bits >= 5) { output += alphabet[(value >>> (bits -= 5)) & 31]; }
    }
    if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
    return output;
}
function decodeBase32(secret: string): Buffer {
    const input = secret.replace(/\s|-/g, "").toUpperCase().replace(/=+$/, "");
    if (input.length < 16 || !/^[A-Z2-7]+$/.test(input)) throw new Error("Invalid TOTP secret");
    let bits = 0, value = 0; const result: number[] = [];
    for (const char of input) {
        value = (value << 5) | alphabet.indexOf(char); bits += 5;
        if (bits >= 8) { result.push((value >>> (bits -= 8)) & 255); }
    }
    return Buffer.from(result);
}
export interface TotpOptions { period?: number; digits?: 6 | 8; algorithm?: "sha1" | "sha256" | "sha512"; now?: number; }
export function generateTotp(secret: string, options: TotpOptions = {}): string {
    const period = options.period ?? 30, digits = options.digits ?? 6;
    if (!Number.isSafeInteger(period) || period < 10 || period > 300 || (digits !== 6 && digits !== 8)) throw new RangeError("Invalid TOTP parameters");
    const timestamp = options.now ?? Date.now();
    if (!Number.isFinite(timestamp) || timestamp < 0) throw new RangeError("Invalid TOTP time");
    const counter = Math.floor(timestamp / (period * 1000));
    const bytes = Buffer.alloc(8); bytes.writeBigUInt64BE(BigInt(counter));
    const digest = createHmac(options.algorithm ?? "sha1", decodeBase32(secret)).update(bytes).digest();
    const offset = digest[digest.length - 1] & 15;
    return String((digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits)).padStart(digits, "0");
}
export function verifyTotp(token: string, secret: string, options: TotpOptions & { window?: number } = {}): boolean {
    const digits = options.digits ?? 6;
    if (typeof token !== "string" || !new RegExp(`^[0-9]{${digits}}$`).test(token)) return false;
    const period = options.period ?? 30, window = options.window ?? 1;
    if (!Number.isSafeInteger(window) || window < 0 || window > 5) throw new RangeError("Invalid TOTP window");
    let match = false;
    for (let n = -window; n <= window; n++) {
        const stamp = (options.now ?? Date.now()) + n * period * 1000;
        if (stamp < 0) continue;
        const candidate = generateTotp(secret, { ...options, now: stamp });
        match = timingSafeEqual(Buffer.from(candidate), Buffer.from(token)) || match;
    }
    return match;
}
export function totpUri(secret: string, account: string, issuer: string, options: TotpOptions = {}): string {
    decodeBase32(secret);
    if (!account || !issuer) throw new Error("Issuer and account are required");
    const params = new URLSearchParams({ secret, issuer, algorithm: (options.algorithm ?? "sha1").toUpperCase(), digits: String(options.digits ?? 6), period: String(options.period ?? 30) });
    return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?${params}`;
}
