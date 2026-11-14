/** Node-only integration policy. Hosting owns encoders and their concurrency. */
import type {
  IncomingMessage,
  ServerResponse,
  IncomingHttpHeaders,
} from 'node:http';
import type { Readable } from 'node:stream';
export interface PerformanceResponseOwner {
  /** Delegate once to the borrowed response/compression owner; that layer owns encoding, backpressure and source teardown.
   * @param {IncomingMessage} request - Borrowed native request.
   * @param {Readable & { headers: IncomingHttpHeaders; statusCode?: number }} source - Owned-by-host readable source with representation metadata.
   * @param {ServerResponse} response - Borrowed native response.
   * @returns {void} Response owner handles delivery; this interface does not implement codecs.
   */
  forward(
    request: IncomingMessage,
    source: Readable & {
      /** Original representation headers; copied/normalized before forwarding. */
      headers: IncomingHttpHeaders;
      /** Optional native response status owned by the hosting layer. */
      statusCode?: number;
    },
    response: ServerResponse
  ): void;
}
export interface PerformanceResponsePolicy {
  /** Required trusted server classification, never a forwarded header. */ authenticated: boolean;
  /** Explicitly public anonymous response only. */ public?: boolean;
}
/** Apply trusted response privacy and delegate to one borrowed compression owner. Never minify, allocate encoders or evaluate conditional requests here.
 * @param {PerformanceResponseOwner} owner - Borrowed hosting compression owner closed by the application.
 * @param {IncomingMessage} request - Native request; auth/cookie headers conservatively force private output.
 * @param {Readable & { headers: IncomingHttpHeaders; statusCode?: number }} source - Host-owned source with pre-transform metadata; headers are replaced by a normalized copy.
 * @param {ServerResponse} response - Uncommitted native response.
 * @param {PerformanceResponsePolicy} policy - Explicit server-verified classification; authenticated public policy rejects.
 * @returns {void} Delegates delivery once; transformed representation metadata remains hosting-owned.
 */
export function forwardPerformanceResponse(
  owner: PerformanceResponseOwner,
  request: IncomingMessage,
  source: Readable & {
    /** Original representation headers; copied/normalized before forwarding. */
    headers: IncomingHttpHeaders;
    /** Optional native response status owned by the hosting layer. */
    statusCode?: number;
  },
  response: ServerResponse,
  policy: PerformanceResponsePolicy
): void {
  if (
    !owner ||
    typeof owner.forward !== 'function' ||
    !policy ||
    typeof policy.authenticated !== 'boolean' ||
    (policy.public !== undefined && typeof policy.public !== 'boolean')
  ) {
    throw new TypeError('Invalid performance response policy');
  }
  if (response.headersSent || response.writableEnded || response.destroyed) {
    throw new Error('Response already committed');
  }
  if (policy.authenticated && policy.public) {
    throw new TypeError('Authenticated responses cannot be public');
  }
  // Cookie/auth headers conservatively override an anonymous public classification.
  /** Fresh case-normalized response header copy; duplicate spellings reject. */
  const headers: IncomingHttpHeaders = {};
  // Process only the explicit representation bytes, native entries or fixed report fields for this call.
  for (const [name, value] of Object.entries(source.headers)) {
    /** Lowercase header name used to reject ambiguous duplicate metadata. */
    const normalized = name.toLowerCase();
    if (Object.hasOwn(headers, normalized)) {
      throw new TypeError('Duplicate response header');
    }
    headers[normalized] = value;
  }
  /** Trusted/auth/cookie/set-cookie classification that forces private no-store output. */
  const sensitive =
    policy.authenticated ||
    request.headers.authorization !== undefined ||
    request.headers.cookie !== undefined ||
    headers['set-cookie'] !== undefined;
  if (sensitive || !policy.public) {
    headers['cache-control'] =
      'private, no-store' +
      (/(?:^|,)\s*no-transform\s*(?:,|$)/i.test(
        String(headers['cache-control'] ?? '')
      )
        ? ', no-transform'
        : '');
    delete headers.expires;
    delete headers['surrogate-control'];
    delete headers['cdn-cache-control'];
  }
  source.headers = headers;
  owner.forward(request, source, response);
}
