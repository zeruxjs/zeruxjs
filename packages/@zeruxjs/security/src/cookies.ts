export interface CookieOptions { maxAgeSeconds?: number; path?: string; domain?: string; httpOnly?: boolean; secure?: boolean; sameSite?: "Strict" | "Lax" | "None"; }
export function serializeCookie(name: string, value: string, options: CookieOptions = {}): string {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new Error("Invalid cookie name");
    if (/[\u0000-\u001f\u007f;]/.test(value)) throw new Error("Invalid cookie value");
    if (name.startsWith("__Host-") && (options.secure !== true || options.path !== "/" || options.domain)) throw new Error("__Host- cookies require Secure, Path=/ and no Domain");
    if (name.startsWith("__Secure-") && !options.secure) throw new Error("__Secure- cookies require Secure");
    const sameSite = options.sameSite ?? "Lax";
    if (sameSite === "None" && !options.secure) throw new Error("SameSite=None requires Secure");
    const parts = [`${name}=${encodeURIComponent(value)}`];
    const path = options.path ?? "/";
    if (!path.startsWith("/") || /[\r\n;]/.test(path)) throw new Error("Invalid cookie path");
    parts.push(`Path=${path}`);
    if (options.domain) {
        if (!/^(?!-)[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*$/.test(options.domain)) throw new Error("Invalid cookie domain");
        parts.push(`Domain=${options.domain}`);
    }
    if (options.maxAgeSeconds !== undefined) {
        if (!Number.isSafeInteger(options.maxAgeSeconds) || options.maxAgeSeconds < 0) throw new RangeError("Invalid cookie Max-Age");
        parts.push(`Max-Age=${options.maxAgeSeconds}`);
    }
    if (options.secure) parts.push("Secure");
    if (options.httpOnly ?? true) parts.push("HttpOnly");
    parts.push(`SameSite=${sameSite}`);
    return parts.join("; ");
}
