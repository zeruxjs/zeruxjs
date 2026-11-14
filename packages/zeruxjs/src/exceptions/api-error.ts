import { HttpError } from './http_error.js';
import { getRequestCorrelation } from '../observability.js';
/** Fixed public API categories; arbitrary private errors cannot supply client-visible codes. */
export const APPLICATION_ERROR_CODES = Object.freeze({
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  408: 'REQUEST_TIMEOUT',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'VALIDATION_FAILED',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  503: 'UNAVAILABLE',
} as const);
export interface ErrorEnvelope {
  /** Safe public failure record without private causes or attached data. */
  error: {
    /** Fixed framework error category. */
    code: string; /** Fixed safe response message. */
    message: string; /** Optional server-generated request correlation, never a credential. */
    requestId?: string;
  };
}
/** Fixed safe response messages; raw causes and attached data stay private. */
const messages: Record<number, string> = {
  400: 'Invalid request',
  401: 'Authentication required',
  403: 'Forbidden',
  404: 'Not found',
  405: 'Method not allowed',
  408: 'Request timeout',
  409: 'Conflict',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Validation failed',
  429: 'Too many requests',
  500: 'Internal server error',
  503: 'Service unavailable',
};
/** Explicit API error; raw cause/details stay internal. Client messages are always fixed. */
export class ApplicationError extends HttpError {
  /** Create an explicitly status-aware API error while keeping the original cause private.
   * @param {number} status - Integer HTTP error status from400through599.
   * @param {unknown} cause - Optional restricted diagnostic cause.
   */
  constructor(status: number, cause?: unknown) {
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw new TypeError('Invalid application error status');
    }
    super(status, messages[status] ?? 'Request failed');
    if (cause !== undefined) {
      Object.defineProperty(this, 'cause', { value: cause });
    }
  }
}
/** Map unknown failures to fixed safe codes/messages and optional server-generated request correlation.
 * @param {unknown} error - Private thrown value; arbitrary messages/data/stacks are not serialized.
 * @returns {{status: number; body: ErrorEnvelope}} Safe public error representation.
 */
export function normalizeApiError(error: unknown): {
  status: number;
  body: ErrorEnvelope;
} {
  let status = 500;
  if (
    error instanceof HttpError &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status <= 599
  ) {
    status = error.status;
  } else if (
    error &&
    typeof error === 'object' &&
    'statusCode' in error &&
    error.statusCode === 413
  ) {
    status = 413;
  }
  /** Current server-generated correlation, never identity or authorization. */
  const context = getRequestCorrelation();
  return {
    status,
    body: {
      error: {
        code:
          APPLICATION_ERROR_CODES[
            status as keyof typeof APPLICATION_ERROR_CODES
          ] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'),
        message:
          messages[status] ??
          (status >= 500 ? 'Internal server error' : 'Request failed'),
        ...(context ? { requestId: context.requestId } : {}),
      },
    },
  };
}
/** Require an explicit positive JSON preference while preserving legacy wildcard/absent behavior.
 * @param {unknown} accept - Untrusted Accept header; oversized/non-string values are ignored.
 * @returns {boolean} Whether JSON preference is positive and at least the HTML preference.
 */
export function acceptsApiError(accept: unknown): boolean {
  if (typeof accept !== 'string' || accept.length > 4096) {
    return false;
  }
  let json = 0,
    html = 0;
  for (const part of accept.split(',').slice(0, 32)) {
    /** Bounded Accept media type and its declared parameters. */
    const [type, ...params] = part.trim().toLowerCase().split(';');
    /** Explicit quality parameter, if present; invalid numeric weights are ignored. */
    const qparam = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
    /** Validated media preference weight used to compare JSON against HTML. */
    const q = qparam ? Number(qparam.slice(2)) : 1;
    if (!Number.isFinite(q) || q < 0 || q > 1) {
      continue;
    }
    if (type === 'application/json' || type === 'application/problem+json') {
      json = Math.max(json, q);
    }
    if (type === 'text/html') {
      html = Math.max(html, q);
    }
  }
  return json > 0 && json >= html;
}
