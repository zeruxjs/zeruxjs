import { normalizeApiError } from './api-error.js';
// Centralised exception handler for ZeruxJS core.
//
// It logs the error using the shared logger and returns a normalized
// object containing an HTTP status code and a JSON‑serialisable body.
// The handler understands `HttpError` (status‑aware) and falls back to
// a generic 500 Internal Server Error for unknown errors.

import { logger } from '../bootstrap/logger.js';
import { HttpError } from './http_error.js';

export interface NormalizedError {
  /** HTTP status code (defaults to 500). */
  status: number;
  /** Payload that can be sent to the client. */
  body: {
    /** Human‑readable error message. */
    message: string;
    /** Legacy type field; framework responses never populate it. */
    stack?: string;
    /** Legacy type field; private error data is never returned. */
    data?: unknown;
  };
}

/** Log through the redacted framework logger and return the legacy safe error shape.
 * @param {unknown} err - Private failure; raw diagnostics belong only in explicit trusted sinks.
 * @returns {NormalizedError} Safe status/message without stack or private data.
 */
export function exceptionHandler(err: unknown): NormalizedError {
  /** Whether the failure uses the framework’s declared status-aware error class. */
  const isHttp = err instanceof HttpError;
  /** Sanitized API normalization shared with request responses. */
  const safe = normalizeApiError(err);
  /** Safe normalized HTTP status, independent of private exception text. */
  const status = safe.status;
  /** Fixed public message rather than raw Error.message. */
  const message = safe.body.error.message;

  // Default logs contain only a safe summary; runtime onError owns trusted raw causes.
  if (isHttp) {
    logger.warn('HTTP request failed', status);
  } else {
    logger.error('Unhandled exception', err);
  }

  /** Legacy response shape containing only the safe message. */
  const body: NormalizedError['body'] = { message };

  return { status, body };
}
