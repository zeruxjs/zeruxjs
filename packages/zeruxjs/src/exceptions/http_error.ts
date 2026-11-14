// HttpError – a lightweight error class that carries an HTTP status code.
//
// Usage:
//   throw new HttpError(404, 'Resource not found');
//
// The class extends the native `Error` and adds a `status` property.
// It can be used by any HTTP‑based component (e.g., the server command,
// API utilities, or custom middleware) to convey proper status codes.

/** Internal status-aware HTTP error; public serializers apply their own fixed redaction policy. */
export class HttpError extends Error {
  /** HTTP status code (e.g., 404, 500). */
  public readonly status: number;

  /** Optional private diagnostics; framework error responses do not serialize this field. */
  public readonly data?: unknown;

  /** Retain host-selected HTTP status/message/data internally; public error serializers redact private details.
   * @param {number} status - Host-selected HTTP status.
   * @param {string} message - Private error message; not automatically exposed.
   * @param {unknown} data - Optional private diagnostic data.
   */
  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.data = data;

    // Maintains proper prototype chain when transpiled to ES5
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
