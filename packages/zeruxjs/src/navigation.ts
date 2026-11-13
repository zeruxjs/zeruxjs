/**
 * Redirect status codes supported by ZeruxJS route handlers.
 *
 * Use temporary redirects for request-preserving route moves, permanent redirects
 * for stable canonical URL moves, and see-other redirects after form submissions.
 */
export enum RedirectType {
  Temporary = 307,
  Permanent = 308,
  Found = 302,
  SeeOther = 303,
}

export interface RedirectResponse {
  /** Explicit framework result discriminator. */
  readonly __zeruxRedirect: true;
  /** Host-selected redirect destination; this marker is not an allowlist. */
  readonly location: string;
  /** Deliberate permanent/temporary/request-preserving redirect policy. */
  readonly statusCode: RedirectType;
}

/** Exact redirect statuses supported by the legacy handler result marker. */
const REDIRECT_STATUS_CODES = new Set<number>([
  RedirectType.Temporary,
  RedirectType.Permanent,
  RedirectType.Found,
  RedirectType.SeeOther,
]);

/** Create the legacy redirect result marker without inferring destination authorization.
 * @param {string | URL} location - Host-validated application path or absolute URL.
 * @param {RedirectType} type - Explicit supported redirect status, default307.
 * @returns {RedirectResponse} Marked response consumed by the framework runtime.
 */
export function redirect(
  location: string | URL,
  type: RedirectType = RedirectType.Temporary
): RedirectResponse {
  /** Caller-selected target serialized as supplied; destination/host authorization remains host-owned. */
  const normalizedLocation = location.toString();

  if (!normalizedLocation) {
    throw new Error('redirect requires a non-empty location.');
  }

  if (!REDIRECT_STATUS_CODES.has(type)) {
    throw new Error(`Unsupported redirect status code "${type}".`);
  }

  return {
    __zeruxRedirect: true,
    location: normalizedLocation,
    statusCode: type,
  };
}

/** Recognize a marked redirect with one of the supported statuses.
 * @param {unknown} value - Handler/middleware return value.
 * @returns {boolean} Whether the runtime should treat this value as a redirect result.
 */
export function isRedirectResponse(value: unknown): value is RedirectResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as RedirectResponse).__zeruxRedirect === true &&
    typeof (value as RedirectResponse).location === 'string' &&
    REDIRECT_STATUS_CODES.has((value as RedirectResponse).statusCode)
  );
}
