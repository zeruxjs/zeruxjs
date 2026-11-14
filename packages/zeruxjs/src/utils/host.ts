import { networkInterfaces } from 'node:os';

/** Normalize the existing host matching syntax; forwarded headers are not verified here.
 * @param {string} value - Host text supplied by the caller.
 * @returns {string} Lowercase host without a single port/trailing dot.
 */
const normalizeHost = (value: string): string => {
  /** Trimmed lowercase input before bracketed IPv6/single-port handling. */
  const host = value.trim().toLowerCase();
  if (host.startsWith('[')) {
    /** Closing IPv6 bracket index; malformed bracket form normalizes to empty. */
    const closing = host.indexOf(']');
    return closing < 0 ? '' : host.slice(1, closing);
  }
  if ((host.match(/:/g) || []).length > 1) {
    return host;
  } // bare IPv6
  return host.split(':', 1)[0]!.replace(/\.$/, '');
};

/** Snapshot local interface addresses with loopback fallbacks.
 * @returns {Set<string>} Local names/addresses; discovery failure remains optional.
 */
const getLocalIps = (): Set<string> => {
  /** Fresh loopback/interface address set, not a remote identity registry. */
  const ips = new Set(['127.0.0.1', '::1', 'localhost']);
  try {
    for (const addresses of Object.values(networkInterfaces())) {
      for (const address of addresses || []) {
        ips.add(address.address.toLowerCase());
      }
    }
  } catch {
    /* Interface discovery is optional. */
  }
  return ips;
};
/** Process-start interface snapshot; not a live trusted-proxy or authorization policy. */
const LOCAL_IPS = getLocalIps();

/** Check local names/interface addresses under the legacy allow-host policy.
 * @param {string} host - Caller-selected host text.
 * @returns {boolean} Whether the normalized host is local.
 */
export const isLocalHost = (host: string): boolean => {
  /** Normalized host checked before matching configured names. */
  const hostname = normalizeHost(host);
  return (
    Boolean(hostname) &&
    (LOCAL_IPS.has(hostname) || hostname.endsWith('.localhost'))
  );
};

/** Apply only exact, star or subdomain-suffix patterns.
 * @param {string} pattern - Trusted configured host pattern.
 * @param {string} host - Normalized candidate host.
 * @returns {boolean} Whether the configured pattern matches.
 */
const matchWildcard = (pattern: string, host: string): boolean => {
  if (pattern === '*') {
    return true;
  }
  if (pattern === host) {
    return true;
  }
  if (pattern.startsWith('*.')) {
    /** Configured wildcard suffix; the bare suffix itself is not a wildcard subdomain. */
    const suffix = pattern.slice(2);
    return Boolean(suffix) && host.endsWith(`.${suffix}`);
  }
  return false;
};

/** Apply legacy local/development/configured host admission without treating it as user authorization.
 * @param {string} host - Candidate host.
 * @param {string | string[]} [allowedDomains] - Trusted exact or wildcard patterns.
 * @param {string} [allowedDevDomain] - Explicit development host.
 * @returns {boolean} Whether the existing allow-host policy admits the name.
 */
export const isAllowedHost = (
  host: string,
  allowedDomains: string | string[] = [],
  allowedDevDomain?: string
): boolean => {
  /** Normalized host checked before matching configured names. */
  const hostname = normalizeHost(host);
  if (!hostname || /[\s/\\@]/.test(hostname)) {
    return false;
  }
  if (isLocalHost(hostname)) {
    return true;
  }
  if (allowedDevDomain && hostname === normalizeHost(allowedDevDomain)) {
    return true;
  }
  /** Configured patterns normalized to an iterable without package/network discovery. */
  const domains = Array.isArray(allowedDomains)
    ? allowedDomains
    : [allowedDomains];
  return domains.some((pattern) =>
    matchWildcard(
      normalizeHost(pattern) === '*'
        ? '*'
        : pattern.toLowerCase().replace(/\.$/, ''),
      hostname
    )
  );
};
