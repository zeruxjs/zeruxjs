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

/**
 * Handles an error, logs it, and returns a normalized representation.
 *
 * @param err - The caught error.
 * @returns NormalizedError – ready to be sent to a client or re‑thrown.
 */
export function exceptionHandler(err: unknown): NormalizedError {
    const isHttp = err instanceof HttpError;
    const safe=normalizeApiError(err);
    const status = safe.status;
    const message = safe.body.error.message;

    // Default logs contain only a safe summary; runtime onError owns trusted raw causes.
    if (isHttp) {
        logger.warn('HTTP request failed', status);
    } else {
        logger.error('Unhandled exception', err);
    }

    const body: NormalizedError['body'] = { message };

    return { status, body };
}
