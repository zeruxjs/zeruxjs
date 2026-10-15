import { IncomingMessage } from "node:http";
import crypto from "node:crypto";

const createNonce = (size = 16) => crypto.randomBytes(size).toString("base64");

const normalizeAncestorOrigin = (value?: string | null) => {
    if (!value) return null;
    try {
        const origin = new URL(value).origin;
        if (origin.startsWith("http://") || origin.startsWith("https://")) {
            return origin;
        }
    } catch {
        return null;
    }
    return null;
};

const getFrameAncestors = (req?: IncomingMessage, registration: any = null) => {

    const localIPs = [
        "localhost",
        "127.0.0.1",
    ];

    const localWildCardIPs = [
        "http://*.localhost",
        "https://*.localhost",
        "http://10.*",
        "https://10.*",
        "http://192.168.*",
        "https://192.168.*",
        "http://172.16.*",
        "https://172.16.*",
    ];
    const ancestors = new Set<string>(["'self'", ...localWildCardIPs]);

    for (const host of localIPs) {
        ancestors.add(`http://${host}`);
        ancestors.add(`https://${host}`);
    }

    const appPort = registration?.appPort;
    if (appPort) {
        for (const host of localIPs) {
            ancestors.add(`http://${host}:${appPort}`);
            ancestors.add(`https://${host}:${appPort}`);
        }
    }

    if (registration) {
        const { allowedDevDomain, allowedDomains } = registration;

        if (allowedDevDomain) {
            ancestors.add(`http://${allowedDevDomain}`);
            ancestors.add(`https://${allowedDevDomain}`);
        }

        const domains = Array.isArray(allowedDomains) ? allowedDomains : [allowedDomains];
        for (const domain of domains) {
            if (domain) {
                ancestors.add(`http://${domain}`);
                ancestors.add(`https://${domain}`);
            }
        }
    }

    const requestOrigin = normalizeAncestorOrigin(String(req?.headers.origin || ""));
    const refererOrigin = normalizeAncestorOrigin(String(req?.headers.referer || ""));
    if (requestOrigin) ancestors.add(requestOrigin);
    if (refererOrigin) ancestors.add(refererOrigin);

    return [...ancestors];
};

const buildContentSecurityPolicy = (
    nonce: string,
    options?: { frameAncestors?: string[] }
) => {
    const frameAncestors = options?.frameAncestors?.length
        ? options.frameAncestors.join(" ")
        : "'self'";

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

const buildFrameAwarePolicy = (nonce: string, req?: IncomingMessage, registration: any = null) => {
    console.log(getFrameAncestors(req, registration).join(" "));
    // return ['self'].join(' ');
    return buildContentSecurityPolicy(nonce).replace(
        "frame-ancestors 'self'",
        `frame-ancestors ${getFrameAncestors(req, registration).join(" ")}`
    );
}

const nonce = createNonce();
console.log(buildFrameAwarePolicy(nonce, { headers: { origin: "http://localhost:3000", referer: "http://localhost:3000" } } as any));
