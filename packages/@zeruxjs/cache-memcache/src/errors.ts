/** Fixed public diagnostics; keys, payloads and server text are never included. Causes stay internal. */
export class MemcacheError extends Error {
  readonly details: { code: string; message: string };
  /** Construct explicit diagnostics. Internal factories supply fixed messages; arbitrary host messages require host redaction.
   * @param {string} code - Stable classification code.
   * @param {string} message - Public message, supplied by trusted host code.
   * @param {ErrorOptions} options - Optional private Error cause metadata.
   */
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'MemcacheError';
    this.details = { code, message };
  }
}

/** Create fixed code-derived public diagnostics; the optional raw cause stays internal.
 * @param {string} code - Stable internal code, never a key or provider response.
 * @param {unknown} cause - Optional private failure cause.
 * @returns {MemcacheError} Code-derived error without request/server values in its message. */
export const memcacheError = (code: string, cause?: unknown) =>
  new MemcacheError(
    code,
    code.toLowerCase().replaceAll('_', ' '),
    cause === undefined ? undefined : { cause }
  );
