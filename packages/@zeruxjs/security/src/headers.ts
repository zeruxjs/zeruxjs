export interface SecureHeadersOptions {
  /** Optional same-origin/same-site/cross-origin resource policy; no authorization is implied. */
  crossOriginResourcePolicy?: 'same-origin' | 'same-site' | 'cross-origin';
  /** Validated opener isolation policy; defaults to same-origin. */
  crossOriginOpenerPolicy?:
    | 'same-origin'
    | 'same-origin-allow-popups'
    | 'unsafe-none';
  /** Optional reviewed embedder isolation policy; configure compatible resources explicitly. */
  crossOriginEmbedderPolicy?: 'require-corp' | 'credentialless' | 'unsafe-none';
  /** Explicit HSTS enable/configuration; emitted only for trusted HTTPS. */
  hsts?:
    | boolean
    | {
        /** Nonnegative safe HSTS age through 63072000 seconds. */
        maxAgeSeconds: number;
        /** Optional explicit HSTS subdomain commitment. */
        includeSubDomains?: boolean;
        /** Optional explicit HSTS preload declaration; this does not submit a domain to a preload list. */
        preload?: boolean;
      };
  /** Reviewed CSP text capped at 16 KiB; control characters reject. */
  csp?: string;
  /** Validated referrer policy; defaults to strict-origin-when-cross-origin. */
  referrerPolicy?:
    | 'no-referrer'
    | 'strict-origin-when-cross-origin'
    | 'same-origin';
  /** Validated DENY/SAMEORIGIN framing policy; defaults to DENY. */
  frameOptions?: 'DENY' | 'SAMEORIGIN';
}
/** Build a fresh validated browser-security header map. Only trusted explicit HTTPS enables HSTS; header emission alone does not certify browser isolation/security.
 * @param {SecureHeadersOptions} options - Explicit reviewed CSP, cross-origin, framing and referrer policy; defaults retain legacy behavior.
 * @param {boolean} https - Trusted host transport fact, default false; never derive blindly from forwarding headers.
 * @returns {Record<string, string>} Per-response header values; malformed enums/flags/control-bearing CSP throw.
 */
export function createSecurityHeaders(
  options: SecureHeadersOptions = {},
  https = false
): Record<string, string> {
  if (!options || typeof options !== 'object' || typeof https !== 'boolean') {
    throw new TypeError('Invalid security header options');
  }
  if (
    options.referrerPolicy !== undefined &&
    !['no-referrer', 'strict-origin-when-cross-origin', 'same-origin'].includes(
      options.referrerPolicy
    )
  ) {
    throw new TypeError('Invalid referrer policy');
  }
  if (
    options.frameOptions !== undefined &&
    !['DENY', 'SAMEORIGIN'].includes(options.frameOptions)
  ) {
    throw new TypeError('Invalid frame policy');
  }
  if (
    options.csp !== undefined &&
    (typeof options.csp !== 'string' || options.csp.length > 16384)
  ) {
    throw new TypeError('Invalid CSP');
  }
  if (
    options.hsts !== undefined &&
    typeof options.hsts !== 'boolean' &&
    (!options.hsts ||
      typeof options.hsts !== 'object' ||
      Array.isArray(options.hsts))
  ) {
    throw new TypeError('Invalid HSTS policy');
  }
  if (
    typeof options.hsts === 'object' &&
    (!Number.isSafeInteger(options.hsts.maxAgeSeconds) ||
      options.hsts.maxAgeSeconds < 0 ||
      options.hsts.maxAgeSeconds > 63072000)
  ) {
    throw new RangeError('Invalid HSTS max age');
  }
  if (typeof options.hsts === 'object') {
    // Validate explicit HSTS commitments even before the trusted HTTPS emission gate.
    for (const flag of ['includeSubDomains', 'preload'] as const) {
      if (
        options.hsts[flag] !== undefined &&
        typeof options.hsts[flag] !== 'boolean'
      ) {
        throw new TypeError('Invalid HSTS flag');
      }
    }
  }
  // Validate each cross-origin policy against its own fixed enum.
  for (const [value, allowed] of [
    [
      options.crossOriginResourcePolicy,
      ['same-origin', 'same-site', 'cross-origin'],
    ],
    [
      options.crossOriginOpenerPolicy,
      ['same-origin', 'same-origin-allow-popups', 'unsafe-none'],
    ],
    [
      options.crossOriginEmbedderPolicy,
      ['require-corp', 'credentialless', 'unsafe-none'],
    ],
  ] as const) {
    if (
      value !== undefined &&
      !(allowed as readonly string[]).includes(value)
    ) {
      throw new TypeError('Invalid cross-origin header policy');
    }
  }
  /** New per-response defense-in-depth header map; no global response is mutated. */
  const headers: Record<string, string> = {
    'x-content-type-options': 'nosniff',
    'referrer-policy':
      options.referrerPolicy ?? 'strict-origin-when-cross-origin',
    'x-frame-options': options.frameOptions ?? 'DENY',
    'cross-origin-opener-policy':
      options.crossOriginOpenerPolicy ?? 'same-origin',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  };
  if (options.crossOriginResourcePolicy) {
    headers['cross-origin-resource-policy'] = options.crossOriginResourcePolicy;
  }
  if (options.crossOriginEmbedderPolicy) {
    headers['cross-origin-embedder-policy'] = options.crossOriginEmbedderPolicy;
  }
  if (options.csp) {
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    if (/[\x00-\x1f\x7f]/.test(options.csp)) {
      throw new Error('Invalid CSP');
    }
    headers['content-security-policy'] = options.csp;
  }
  if (https && options.hsts) {
    /** Validated HSTS policy; true uses one year and trusted HTTPS gates emission. */
    const config =
      options.hsts === true ? { maxAgeSeconds: 31536000 } : options.hsts;
    headers['strict-transport-security'] =
      `max-age=${config.maxAgeSeconds}` +
      ('includeSubDomains' in config && config.includeSubDomains
        ? '; includeSubDomains'
        : '') +
      ('preload' in config && config.preload ? '; preload' : '');
  }
  return headers;
}
