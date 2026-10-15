// HttpError – a lightweight error class that carries an HTTP status code.
//
// Usage:
//   throw new HttpError(404, 'Resource not found');
//
// The class extends the native `Error` and adds a `status` property.
// It can be used by any HTTP‑based component (e.g., the server command,
// API utilities, or custom middleware) to convey proper status codes.

export class HttpError extends Error {
  /** HTTP status code (e.g., 404, 500). */
  public readonly status: number;

  /** Optional additional data that callers may want to expose. */
  public readonly data?: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.data = data;

    // Maintains proper prototype chain when transpiled to ES5
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
