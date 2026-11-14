/** Parse a bounded authority without accepting credentials, paths, queries or fragments for route selection.
 * @param {string} authority - Untrusted request Host or authority value.
 * @returns {{ hostname: string; port?: number } | null} Normalized routing authority or null; this alone does not authorize a destination.
 */
export function parseAuthority(
  authority: string
): { hostname: string; port?: number } | null {
  if (!authority || authority.length > 255 || /[\s\\/@?#,]/.test(authority)) {
    return null;
  }
  try {
    /** Inert URL parser used to reject authority components; no network fetch occurs. */
    const url = new URL(`http://${authority}`);
    if (
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    /** Lower-case routing hostname with surrounding IPv6 brackets and trailing dot removed. */
    const hostname = url.hostname
      .replace(/^\[|\]$/g, '')
      .toLowerCase()
      .replace(/\.$/, '');
    if (!hostname || !/^[a-z0-9.:[\]-]+$/i.test(url.hostname)) {
      return null;
    }
    /** Optional validated native URL port. */
    const port = url.port ? Number(url.port) : undefined;
    if (
      port !== undefined &&
      (!Number.isInteger(port) || port < 1 || port > 65535)
    ) {
      return null;
    }
    return { hostname, port };
  } catch {
    return null;
  }
}

/** Read the bounded internal proxy-loop counter without accepting arrays or alternate numeric forms.
 * @param {string | string[] | undefined} value - Unknown native request header value.
 * @returns {number | null} Zero for absence, a bounded decimal hop count, or null for invalid input.
 */
export function readHopCount(
  value: string | string[] | undefined
): number | null {
  if (value === undefined) {
    return 0;
  }
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,5})$/.test(value)) {
    return null;
  }
  /** Validated decimal counter converted only after syntax checks. */
  const count = Number(value);
  return count <= 100_000 ? count : null;
}

/** Construct fresh forwarding fields from the actual direct-peer connection; callers first remove untrusted aliases and validate authority.
 * @param {string} authority - Previously validated request authority.
 * @param {string | undefined} remoteAddress - Native direct peer address; never a client-supplied header.
 * @param {boolean} secure - Whether this serving connection uses TLS.
 * @returns {Record<string, string>} Fresh peer metadata with protocol-derived default port.
 */
export function createForwardedHeaders(
  authority: string,
  remoteAddress: string | undefined,
  secure: boolean
): Record<string, string> {
  /** Parsed authority used for a safe protocol-default forwarding port. */
  const parsed = parseAuthority(authority);
  /** Protocol of the serving connection, derived from its actual TLS state. */
  const proto = secure ? 'https' : 'http';
  return {
    'x-forwarded-for': remoteAddress || '127.0.0.1',
    'x-forwarded-proto': proto,
    'x-forwarded-host': authority,
    'x-forwarded-port': String(parsed?.port ?? (secure ? 443 : 80)),
  };
}

/** Select an exact case-insensitive route or the longest parent-domain suffix from the supplied host-owned inventory.
 * @param {T[]} routes - Borrowed trusted route records; this method never mutates their array.
 * @param {string} hostname - Previously validated normalized request host.
 * @returns {T | undefined} Borrowed matching route or undefined; authentication remains separate.
 */
export function matchProxyRoute<T extends { hostname: string }>(
  routes: T[],
  hostname: string
): T | undefined {
  /** Case-normalized requested host used for exact and parent-route matching. */
  const host = hostname.toLowerCase();
  return (
    routes.find((route) => route.hostname.toLowerCase() === host) ??
    routes
      .filter((route) => host.endsWith(`.${route.hostname.toLowerCase()}`))
      .sort((a, b) => b.hostname.length - a.hostname.length)[0]
  );
}
