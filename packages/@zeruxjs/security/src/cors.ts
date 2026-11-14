export interface CorsOptions {
  /** Exact allowed canonical origins or a trusted synchronous boolean predicate. */
  origins: readonly string[] | ((origin: string) => boolean);
  /** Bounded HTTP method names; defaults preserve explicit legacy CRUD methods. */
  methods?: readonly string[];
  /** Bounded permitted request headers; default Content-Type, Authorization and X-CSRF-Token. */
  headers?: readonly string[];
  /** Optional bounded response headers exposed to allowed browser origins. */
  exposeHeaders?: readonly string[];
  /** Explicit credentialed CORS permission; never inferred from a caller cookie. */
  credentials?: boolean;
  /** Optional preflight age from zero through 86400 seconds. */
  maxAgeSeconds?: number;
}
export interface CorsResult {
  /** Explicit policy decision, not proof of user authorization. */
  allowed: boolean;
  /** 200 for permitted ordinary requests,204 for permitted preflight,403 for denial. */
  status: 200 | 204 | 403;
  /** Fresh response headers, including Vary even when the request is denied. */
  headers: Record<string, string>;
}
/** HTTP token grammar for methods/header names; no arbitrary header text is emitted. */
const httpToken = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
/** Validate bounded token lists before serializing CORS response values.
 * @param {readonly string[]} values - At most128 valid method/header tokens.
 * @returns {string} Comma-separated serialized token list; malformed input throws.
 */
const list = (values: readonly string[]) => {
  if (
    !Array.isArray(values) ||
    values.length > 128 ||
    values.some(
      (v) => typeof v !== 'string' || v.length > 128 || !httpToken.test(v)
    )
  ) {
    throw new Error('Invalid CORS token');
  }
  return values.join(', ');
};
/** Evaluate a canonical HTTP(S) origin against an explicit allowlist or synchronous host predicate. CORS is not authentication, authorization or CSRF protection.
 * @param {string | undefined} origin - Serialized request origin; missing/null/noncanonical origins are denied.
 * @param {CorsOptions} options - Host-reviewed origin, credential and bounded method/header policy.
 * @param {{ method: string; headers?: string }} preflight - Optional method/requested-header data; denied responses still retain the required Vary fields.
 * @param {string} preflight.method - Requested preflight method token.
 * @param {string} preflight.headers - Optional comma-separated requested headers.
 * @returns {CorsResult} Explicit permission/status/headers; malformed host policy throws rather than granting access.
 */
export function evaluateCors(
  origin: string | undefined,
  options: CorsOptions,
  preflight?: {
    /** Requested preflight method token. */
    method: string;
    /** Bounded permitted request headers; default Content-Type, Authorization and X-CSRF-Token. */
    headers?: string;
  }
): CorsResult {
  if (
    !options ||
    typeof options !== 'object' ||
    (typeof options.origins !== 'function' &&
      (!Array.isArray(options.origins) ||
        options.origins.length > 128 ||
        options.origins.some(
          (value) => typeof value !== 'string' || value.length > 2048
        )))
  ) {
    throw new TypeError('Invalid CORS origin policy');
  }
  if (
    options.credentials !== undefined &&
    typeof options.credentials !== 'boolean'
  ) {
    throw new TypeError('Invalid CORS credentials policy');
  }
  /** Fresh Vary/header map preserved even on preflight denial. */
  const headers: Record<string, string> = {
    vary: preflight
      ? 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers'
      : 'Origin',
  };
  if (
    typeof origin !== 'string' ||
    !origin ||
    origin === 'null' ||
    origin.length > 2048
  ) {
    return { allowed: false, status: 403, headers };
  }
  try {
    /** Parsed serialized request origin; path/query/credential forms do not match canonical origin. */
    const source = new URL(origin);
    if (
      !['http:', 'https:'].includes(source.protocol) ||
      source.origin !== origin
    ) {
      return { allowed: false, status: 403, headers };
    }
  } catch {
    return { allowed: false, status: 403, headers };
  }
  if (
    typeof options.origins === 'function' &&
    options.origins.constructor.name === 'AsyncFunction'
  ) {
    throw new TypeError('CORS predicates must return a synchronous boolean');
  }
  /** Explicit synchronous host decision; Promise/nonboolean values are rejected. */
  const allowed =
    typeof options.origins === 'function'
      ? options.origins(origin)
      : options.origins.some((item) => item === origin);
  if (
    allowed &&
    typeof (allowed as unknown as PromiseLike<unknown>).then === 'function'
  ) {
    void Promise.resolve(allowed).catch(() => {});
    throw new TypeError('CORS predicates must return a synchronous boolean');
  }
  if (typeof allowed !== 'boolean') {
    throw new TypeError('CORS predicates must return a synchronous boolean');
  }
  if (!allowed) {
    return { allowed: false, status: 403, headers };
  }
  /** Captured configured methods or the legacy explicit CRUD defaults. */
  const configuredMethods = options.methods ?? [
    'GET',
    'HEAD',
    'POST',
    'PUT',
    'PATCH',
    'DELETE',
  ];
  list(configuredMethods);
  /** Validated uppercase method tokens used for case-insensitive method checks. */
  const methods = configuredMethods.map((value) => value.toUpperCase());
  /** Explicit allowed request-header names; comparison is case-insensitive. */
  const allowedHeaders = options.headers ?? [
    'Content-Type',
    'Authorization',
    'X-CSRF-Token',
  ];
  list(allowedHeaders);
  if (options.exposeHeaders !== undefined) {
    list(options.exposeHeaders);
  }
  if (preflight) {
    if (
      typeof preflight.method !== 'string' ||
      preflight.method.length > 128 ||
      !httpToken.test(preflight.method) ||
      !methods.includes(preflight.method.toUpperCase())
    ) {
      return { allowed: false, status: 403, headers };
    }
    if (
      preflight.headers !== undefined &&
      (typeof preflight.headers !== 'string' || preflight.headers.length > 8192)
    ) {
      return { allowed: false, status: 403, headers };
    }
    /** Bounded individual preflight header names parsed from the requested-header field. */
    const requested = (preflight.headers ?? '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (
      requested.length > 128 ||
      requested.some(
        (v) =>
          !httpToken.test(v) ||
          !allowedHeaders.some((h) => h.toLowerCase() === v.toLowerCase())
      )
    ) {
      return { allowed: false, status: 403, headers };
    }
    headers['access-control-allow-methods'] = list(methods);
    headers['access-control-allow-headers'] = list(allowedHeaders);
    if (options.maxAgeSeconds !== undefined) {
      if (
        !Number.isSafeInteger(options.maxAgeSeconds) ||
        options.maxAgeSeconds < 0 ||
        options.maxAgeSeconds > 86400
      ) {
        throw new RangeError('Invalid CORS max age');
      }
      headers['access-control-max-age'] = String(options.maxAgeSeconds);
    }
  }
  headers['access-control-allow-origin'] = origin;
  if (options.credentials) {
    headers['access-control-allow-credentials'] = 'true';
  }
  if (options.exposeHeaders?.length) {
    headers['access-control-expose-headers'] = list(options.exposeHeaders);
  }
  return { allowed: true, status: preflight ? 204 : 200, headers };
}
