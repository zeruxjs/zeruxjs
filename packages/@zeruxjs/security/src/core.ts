import { escapeHtmlText } from './encoding.js';
import crypto from "node:crypto";
import path from "node:path";

const unsafePathPattern = /(^|[\\/])\.\.(?:[\\/]|$)/;

export const createNonce = (size = 16) => {
    if (!Number.isSafeInteger(size) || size < 16 || size > 64) throw new RangeError("CSP nonce size must be 16–64 bytes");
    return crypto.randomBytes(size).toString("base64");
};

/** Legacy HTML text/quoted ordinary-attribute encoder; not a generic sanitizer. */
export const escapeHtml = escapeHtmlText;
export { serializeJsonForScript } from './encoding.js';

export const sanitizeIdentifier = (value: unknown, fallback = "item") => {
    const normalized = String(value ?? "")
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "");
    const safeFallback = String(fallback ?? 'item').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    return normalized || safeFallback || 'item';
};

export const sanitizeRelativeAssetPath = (value: unknown) => {
    const target = String(value ?? "").trim();
    if (!target || path.isAbsolute(target) || /^[A-Za-z]:/.test(target) || target.startsWith("\\\\") || target.startsWith("//") || target.includes("\0") || /[?#:]|%(?:2e|2f|5c)/i.test(target) || unsafePathPattern.test(target)) {
        return null;
    }
    return target.replace(/\\/g, "/");
};

export const ensurePathInsideRoot = (rootDir: string, targetPath: string) => {
    const relative = path.relative(rootDir, targetPath);
    return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
};

export const buildContentSecurityPolicy = (
    nonce: string,
    options?: { frameAncestors?: string[] }
) => {
    if (typeof nonce !== 'string' || !/^[A-Za-z0-9+/_=-]{16,256}$/.test(nonce)) throw new Error("Invalid CSP nonce");
    if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options))) throw new TypeError('Invalid CSP options');
    if (options?.frameAncestors !== undefined && (!Array.isArray(options.frameAncestors) || options.frameAncestors.length > 64 || options.frameAncestors.some(item => typeof item !== 'string' || item.length > 256))) throw new TypeError('Invalid frame-ancestors sources');
    if (options?.frameAncestors?.includes("'none'") && options.frameAncestors.length > 1) throw new TypeError('Invalid frame-ancestors sources');
    const frameAncestors = options?.frameAncestors?.length
        ? options.frameAncestors.join(" ")
        : "'self'";

    if (options?.frameAncestors?.some(item => !/^(?:'self'|'none'|https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?)$/.test(item))) throw new Error("Invalid frame-ancestors source");
    return [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}'`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self' ws: wss: http: https:",
        `frame-ancestors ${frameAncestors}`,
        "base-uri 'self'",
        "object-src 'none'"
    ].join("; ");
};
