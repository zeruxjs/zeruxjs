/** Validate request authority before using it for routing. */
export function parseAuthority(authority: string): { hostname: string; port?: number } | null {
  if (!authority || authority.length > 255 || /[\s\\/@?#,]/.test(authority)) return null;
  try {
    const url = new URL(`http://${authority}`);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
    if (!hostname || !/^[a-z0-9.:[\]-]+$/i.test(url.hostname)) return null;
    const port = url.port ? Number(url.port) : undefined;
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) return null;
    return { hostname, port };
  } catch { return null; }
}

export function readHopCount(value: string | string[] | undefined): number | null {
  if (value === undefined) return 0;
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,5})$/.test(value)) return null;
  const count = Number(value);
  return count <= 100_000 ? count : null;
}

/** Never accept untrusted client-provided forwarding metadata. */
export function createForwardedHeaders(authority: string, remoteAddress: string | undefined, secure: boolean): Record<string, string> {
  const parsed = parseAuthority(authority);
  const proto = secure ? 'https' : 'http';
  return {
    'x-forwarded-for': remoteAddress || '127.0.0.1',
    'x-forwarded-proto': proto,
    'x-forwarded-host': authority,
    'x-forwarded-port': String(parsed?.port ?? (secure ? 443 : 80)),
  };
}

export function matchProxyRoute<T extends { hostname: string }>(routes: T[], hostname: string): T | undefined {
  const host = hostname.toLowerCase();
  return routes.find(route => route.hostname.toLowerCase() === host)
    ?? routes.filter(route => host.endsWith(`.${route.hostname.toLowerCase()}`))
      .sort((a, b) => b.hostname.length - a.hostname.length)[0];
}
