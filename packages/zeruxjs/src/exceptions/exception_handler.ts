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
        /** Optional stack trace – only included in non‑production builds. */
        stack?: string;
        /** Any extra data attached to the original error. */
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
    const status = isHttp ? err.status : 500;
    const message = isHttp ? err.message : 'Internal Server Error';
    const data = isHttp && (err as HttpError).data !== undefined ? (err as HttpError).data : undefined;

    // Log the error – include stack for debugging purposes.
    if (isHttp) {
        logger.warn(`HttpError ${status}: ${message}`, data);
    } else {
        logger.error('Unhandled exception', err);
    }

    const body: NormalizedError['body'] = { message };
    if (process.env.NODE_ENV !== 'production' && err instanceof Error) {
        body.stack = err.stack;
    }
    if (data !== undefined) {
        body.data = data;
    }

    return { status, body };
}
