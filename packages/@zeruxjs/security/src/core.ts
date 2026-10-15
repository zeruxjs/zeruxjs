import crypto from "node:crypto";
import path from "node:path";

const unsafePathPattern = /(^|[\\/])\.\.(?:[\\/]|$)/;

export const createNonce = (size = 16) => {
    if (!Number.isSafeInteger(size) || size < 16 || size > 64) throw new RangeError("CSP nonce size must be 16–64 bytes");
    return crypto.randomBytes(size).toString("base64");
};

export const escapeHtml = (value: unknown) =>
    String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

export const serializeJsonForScript = (value: unknown) =>
    JSON.stringify(value ?? {})
        .replace(/</g, "\\u003c")
        .replace(/>/g, "\\u003e")
        .replace(/&/g, "\\u0026")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");

export const sanitizeIdentifier = (value: unknown, fallback = "item") => {
    const normalized = String(value ?? "")
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/-{2,}/g, "-")
        .replace(/^-+|-+$/g, "");
    return normalized || fallback;
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
    if (!/^[A-Za-z0-9+/_=-]{16,256}$/.test(nonce)) throw new Error("Invalid CSP nonce");
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
