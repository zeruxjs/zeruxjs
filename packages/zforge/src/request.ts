import type { IncomingMessage } from 'node:http';

/** Bounded request-read failure carrying only an operational message and HTTP status. */
export class RequestBodyError extends Error {
  /** Create a body-read error with an explicit HTTP status for the trusted response boundary.
   * @param {string} message - Operational error description; callers must not include private body values.
   * @param {number} statusCode - HTTP status associated with this bounded read failure.
   */
  constructor(
    message: string,
    readonly statusCode: number
  ) {
    super(message);
    this.name = 'RequestBodyError';
  }
}

/** Read a borrowed native request with an aggregate byte cap and single-settlement cleanup.
 * @param {IncomingMessage} req - Borrowed incoming request; failure pauses it but does not take socket ownership.
 * @param {number} limit - Maximum aggregate body bytes; defaults to one MiB.
 * @returns {Promise<Buffer>} Complete request body, or rejection after owned listeners are removed.
 */
export function readLimitedBody(
  req: IncomingMessage,
  limit = 1024 * 1024
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    /** Request-owned byte chunks retained only until settlement within the declared body limit. */
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    /** Remove exactly the listeners installed by this body read.
     * @returns {void} Releases data/end/error/abort listeners without destroying the borrowed request.
     */
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAbort);
    };
    /** Reject this body read once and stop consuming its borrowed source.
     * @param {Error} error - Failure retained for the trusted HTTP boundary.
     * @returns {void} Pauses the request and releases owned listeners before rejection.
     */
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      req.pause();
      reject(error);
    };
    /** Account incoming bytes before retaining them.
     * @param {Buffer | string} chunk - Native request data chunk.
     * @returns {void} Appends only bytes within the configured aggregate limit.
     */
    const onData = (chunk: Buffer | string) => {
      /** Byte-normalized current chunk counted before it enters the retained body list. */
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += data.length;
      if (size > limit) {
        return fail(
          new RequestBodyError('Devtools request body too large', 413)
        );
      }
      chunks.push(data);
    };
    /** Complete the body read only after the request end event.
     * @returns {void} Releases owned listeners and resolves the exact accumulated bytes once.
     */
    const onEnd = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    /** Forward the native source error through the single-settlement failure path.
     * @param {Error} error - Native request read failure.
     * @returns {void} Rejects with listener cleanup.
     */
    const onError = (error: Error) => fail(error);
    /** Report caller disconnect through the same owned-listener cleanup path.
     * @returns {void} Rejects the aborted read with its HTTP-facing status.
     */
    const onAbort = () => fail(new RequestBodyError('Request aborted', 400));
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('aborted', onAbort);
  });
}

/** Classify a direct development authority without granting authentication or proxy trust.
 * @param {string} host - Direct authority string under validation; never a forwarded identity claim.
 * @returns {boolean} True only for the implemented localhost, localhost-subdomain and loopback forms.
 */
export function localDevHost(host: string): boolean {
  if (!host || /[\s\\/@?#,]/.test(host)) {
    return false;
  }
  try {
    /** Parsed direct authority used only for local development hostname classification. */
    const url = new URL(`http://${host}`);
    if (url.username || url.password || url.pathname !== '/') {
      return false;
    }
    /** Normalized authority hostname; forwarding headers and application identity are outside this helper. */
    const name = url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '');
    return (
      name === 'localhost' ||
      name.endsWith('.localhost') ||
      name === '127.0.0.1' ||
      name === '::1'
    );
  } catch {
    return false;
  }
}
