import { networkInterfaces } from "node:os";

const normalizeHost = (value: string): string => {
    const host = value.trim().toLowerCase();
    if (host.startsWith("[")) {
        const closing = host.indexOf("]");
        return closing < 0 ? "" : host.slice(1, closing);
    }
    if ((host.match(/:/g) || []).length > 1) return host; // bare IPv6
    return host.split(":", 1)[0].replace(/\.$/, "");
};

const getLocalIps = (): Set<string> => {
    const ips = new Set(["127.0.0.1", "::1", "localhost"]);
    try {
        for (const addresses of Object.values(networkInterfaces())) {
            for (const address of addresses || []) ips.add(address.address.toLowerCase());
        }
    } catch { /* Interface discovery is optional. */ }
    return ips;
};
const LOCAL_IPS = getLocalIps();

export const isLocalHost = (host: string): boolean => {
    const hostname = normalizeHost(host);
    return Boolean(hostname) && (LOCAL_IPS.has(hostname) || hostname.endsWith(".localhost"));
};

const matchWildcard = (pattern: string, host: string): boolean => {
    if (pattern === "*") return true;
    if (pattern === host) return true;
    if (pattern.startsWith("*.")) {
        const suffix = pattern.slice(2);
        return Boolean(suffix) && host.endsWith(`.${suffix}`);
    }
    return false;
};

export const isAllowedHost = (
    host: string,
    allowedDomains: string | string[] = [],
    allowedDevDomain?: string
): boolean => {
    const hostname = normalizeHost(host);
    if (!hostname || /[\s\/\\@]/.test(hostname)) return false;
    if (isLocalHost(hostname)) return true;
    if (allowedDevDomain && hostname === normalizeHost(allowedDevDomain)) return true;
    const domains = Array.isArray(allowedDomains) ? allowedDomains : [allowedDomains];
    return domains.some((pattern) => matchWildcard(normalizeHost(pattern) === "*" ? "*" : pattern.toLowerCase().replace(/\.$/, ""), hostname));
};
