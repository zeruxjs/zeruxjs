import * as fs from 'node:fs';

/** Best-effort sudo ownership repair for explicitly supplied paths; no-op on Windows or without root/sudo identity.
 * @param {string[]} paths - Trusted host paths whose ownership should return to the invoking sudo user.
 * @returns {void} Individual chown failures are intentionally ignored; this is not path validation.
 */
export function fixOwnership(...paths: string[]): void {
  if (process.platform === 'win32') {
    return;
  }
  /** Sudo caller user ID, used only when the current process is root. */
  const uid = process.env.SUDO_UID;
  /** Optional sudo caller group ID, defaulting to the supplied user ID. */
  const gid = process.env.SUDO_GID;
  if (!uid || process.getuid?.() !== 0) {
    return;
  }
  for (const p of paths) {
    try {
      fs.chownSync(p, parseInt(uid, 10), parseInt(gid || uid, 10));
    } catch {
      // Best-effort
    }
  }
}

/** Recognize an Error carrying a string filesystem/system code without serializing its private cause.
 * @param {unknown} err - Unknown caught value.
 * @returns {boolean} Whether err is a Node-style coded Error.
 */
export function isErrnoException(err: unknown): err is NodeJS.ErrnoException {
  return (
    err instanceof Error &&
    'code' in err &&
    typeof (err as Record<string, unknown>).code === 'string'
  );
}

/** Encode text for HTML text or quoted attribute contexts; not a JavaScript, CSS or URL-policy encoder.
 * @param {string} str - Untrusted text to serialize into an HTML response.
 * @returns {string} Text with ampersands, angle brackets and both quote forms encoded.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format a host-controlled proxy URL, omitting the protocol’s default port.
 * @param {string} hostname - Already validated hostname; this formatter is not an origin allowlist.
 * @param {number} proxyPort - Listener port used in generated links.
 * @param {boolean} tls - Whether the public URL uses HTTPS; defaults to false.
 * @returns {string} HTTP or HTTPS URL with an explicit nondefault port.
 */
export function formatUrl(
  hostname: string,
  proxyPort: number,
  tls = false
): string {
  /** Scheme chosen by the host-controlled TLS setting. */
  const proto = tls ? 'https' : 'http';
  /** Standard port omitted from URLs for this scheme. */
  const defaultPort = tls ? 443 : 80;
  return proxyPort === defaultPort
    ? `${proto}://${hostname}`
    : `${proto}://${hostname}:${proxyPort}`;
}

/** Normalize a local app name under the configured TLD, retaining legacy localhost-suffix migration behavior.
 * @param {string} input - Operator-provided app name or HTTP(S) URL-like hostname input.
 * @param {string} tld - Host-controlled DNS suffix, defaulting to localhost.
 * @returns {string} Lowercase hostname with validated app labels; does not resolve or authorize a destination.
 */
export function parseHostname(input: string, tld = 'localhost'): string {
  /** Configured dot-prefixed suffix appended after removing a legacy localhost suffix. */
  const suffix = `.${tld}`;

  // Remove any protocol prefix
  let hostname = input
    .trim()
    .replace(/^https?:\/\//, '')
    .split('/')[0]!
    .toLowerCase();

  // Backward compat: strip default .localhost suffix when switching to a custom TLD
  if (tld !== 'localhost' && hostname.endsWith('.localhost')) {
    hostname = hostname.slice(0, -'.localhost'.length);
  }

  // Validate non-empty
  if (!hostname || hostname === suffix) {
    throw new Error('Hostname cannot be empty');
  }

  // Add TLD suffix if not present
  if (!hostname.endsWith(suffix)) {
    hostname = `${hostname}${suffix}`;
  }

  // Validate hostname characters (letters, digits, hyphens, dots)
  /** App-owned hostname labels, validated separately from the host-controlled suffix. */
  const name = hostname.slice(0, -suffix.length);
  if (name.includes('..')) {
    throw new Error(
      `Invalid hostname "${name}": consecutive dots are not allowed`
    );
  }
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(name)) {
    throw new Error(
      `Invalid hostname "${name}": must contain only lowercase letters, digits, hyphens, and dots`
    );
  }

  // Validate per-label length (RFC 1035: max 63 characters per label)
  /** Dot-separated app labels checked against the DNS label-size limit. */
  const labels = name.split('.');
  for (const label of labels) {
    if (label.length > 63) {
      throw new Error(
        `Invalid hostname "${name}": label "${label}" exceeds 63-character DNS limit`
      );
    }
  }

  return hostname;
}
