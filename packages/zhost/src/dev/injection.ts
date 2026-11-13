import { injectDevClient, isPrimaryHtmlRequest } from 'zforge';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Only buffer small, identity-encoded HTML pages. Large pages and streaming
 * responses are passed through byte-for-byte without client injection. */
export const MAX_INJECTED_HTML_BYTES = 2 * 1024 * 1024;
export interface DevInjectionOptions {
  /** Host-controlled development service label, not a caller role. */
  serviceName: string;
  /** Host-controlled development route label. */
  routeName: string;
  /** Explicit host-approved development client origin; never request-selected. */
  devServerUrl: string;
  /** Optional host-approved development alias policy forwarded to the existing devtools encoder. */
  allowedDevDomain?: string | null;
  /** Borrowed current alias holder owned by the development server. */
  devPortLessAlias: {
    /** Current host alias value; null/false preserve their existing disabled/unavailable meanings. */
    value: string | null | false;
  };
}

/** Wrap a trusted development handler with bounded identity-HTML injection, preserving enforced CSP and explicit streaming opt-out.
 * @param {(req: IncomingMessage, res: ServerResponse) => Promise<void> | void} handler - Borrowed host request handler; errors propagate after response methods are restored.
 * @param {DevInjectionOptions} options - Host-approved development-client settings; this wrapper grants no authentication or origin permission.
 * @returns {(req: IncomingMessage, res: ServerResponse) => Promise<void | ServerResponse>} Per-request adapter; no server, socket or global listener is started by this factory.
 */
export function createInjectedAppHandler(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void,
  options: DevInjectionOptions
) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (!isPrimaryHtmlRequest(req)) {
      return handler(req, res);
    }

    /** Captured bound native header writer, restored before passthrough/final send. */
    const writeHead = res.writeHead.bind(res);
    /** Captured bound native write implementation owning actual socket backpressure. */
    const write = res.write.bind(res);
    /** Captured bound native terminal writer used after injection or passthrough. */
    const end = res.end.bind(res);
    /** Captured bound native header setter, preserving native value validation. */
    const setHeader = res.setHeader.bind(res);
    /** Captured bound native explicit commit; calling the wrapper disables injection buffering. */
    const flushHeaders = res.flushHeaders.bind(res);
    /** Pending source byte chunks retained only while injection remains within the existing HTML byte budget. */
    const chunks: Buffer[] = [];
    let bytes = 0;
    let passthrough = false;
    let ended = false;

    /** Restore native response behavior through the captured bound methods before passthrough, final send or error propagation.
     * @returns {void} Restores call behavior; bound function object identity differs from the original methods.
     */
    function restore(): void {
      res.writeHead = writeHead as typeof res.writeHead;
      res.write = write as typeof res.write;
      res.end = end as typeof res.end;
      res.setHeader = setHeader as typeof res.setHeader;
      res.flushHeaders = flushHeaders;
    }
    /** Switch once to native streaming and flush pending bytes without transformation, releasing buffered chunk references.
     * @returns {void} Subsequent writes use native backpressure and callbacks.
     */
    function flushBuffered(): void {
      if (passthrough) {
        return;
      }
      passthrough = true;
      restore();
      for (const buffer of chunks) {
        write(buffer);
      }
      chunks.length = 0;
    }
    // Explicit streaming commits headers immediately and opts out of buffering.
    res.flushHeaders = () => {
      flushBuffered();
      flushHeaders();
    };
    // writeHead can be called before the last chunk; defer it only until
    // the point at which headers/body are actually sent.
    res.writeHead = ((
      status: number,
      reasonOrHeaders?: any,
      maybeHeaders?: any
    ) => {
      res.statusCode = status;
      /** Header representation selected from the supported native writeHead overload shape. */
      const supplied =
        typeof reasonOrHeaders === 'string' ? maybeHeaders : reasonOrHeaders;
      if (Array.isArray(supplied)) {
        if (supplied.length % 2) {
          throw new TypeError('Invalid raw response headers');
        }
        /** Case-insensitive raw header groups preserving repeated field values, including enforced CSP. */
        const pairs = new Map<
          string,
          { name: string; values: (string | number)[] }
        >();
        for (let index = 0; index < supplied.length; index += 2) {
          /** Candidate raw header name checked for string shape before grouping. */
          const name = supplied[index];
          if (typeof name !== 'string') {
            throw new TypeError('Invalid raw response header name');
          }
          /** Lowercase grouping key; original field spelling remains in the retained record. */
          const key = name.toLowerCase();
          /** Existing raw-header group whose repeated values must not be overwritten. */
          const prior = pairs.get(key);
          if (prior) {
            prior.values.push(supplied[index + 1]);
          } else {
            pairs.set(key, { name, values: [supplied[index + 1]] });
          }
        }
        for (const { name, values } of pairs.values()) {
          setHeader(
            name,
            values.length === 1 ? values[0]! : values.map(String)
          );
        }
      } else if (supplied) {
        for (const [name, value] of Object.entries(supplied)) {
          if (value !== undefined) {
            setHeader(name, value as string | number | readonly string[]);
          }
        }
      }
      return res;
    }) as typeof res.writeHead;
    res.write = ((chunk: any, encoding?: any, callback?: any) => {
      if (passthrough) {
        return write(chunk, encoding, callback);
      }
      /** Current byte chunk normalized without evaluating or compiling its content. */
      const buffer = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(
            chunk,
            typeof encoding === 'string'
              ? (encoding as BufferEncoding)
              : undefined
          );
      chunks.push(buffer);
      bytes += buffer.length;
      if (bytes > MAX_INJECTED_HTML_BYTES) {
        flushBuffered();
      }
      /** Buffered-write callback selected from the existing encoding/callback overload bridge. */
      const cb = typeof encoding === 'function' ? encoding : callback;
      if (typeof cb === 'function') {
        cb();
      }
      return !res.writableNeedDrain;
    }) as typeof res.write;
    res.end = ((chunk?: any, encoding?: any, callback?: any) => {
      if (ended) {
        return res;
      }
      ended = true;
      if (passthrough) {
        return end(chunk, encoding, callback);
      }
      if (chunk !== undefined && chunk !== null) {
        /** Current byte chunk normalized without evaluating or compiling its content. */
        const buffer = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(
              chunk,
              typeof encoding === 'string'
                ? (encoding as BufferEncoding)
                : undefined
            );
        chunks.push(buffer);
        bytes += buffer.length;
      }
      /** Declared response MIME used to decide whether complete buffered bytes are HTML. */
      const contentType = String(
        res.getHeader('content-type') ?? ''
      ).toLowerCase();
      /** Declared representation coding; encoded bytes are never decoded or transformed here. */
      const contentEncoding = String(
        res.getHeader('content-encoding') ?? ''
      ).toLowerCase();
      /** Whether the application supplied an enforced CSP; this wrapper never weakens it or guesses a nonce. */
      const hasEnforcedCsp =
        res.getHeader('content-security-policy') !== undefined;
      // The application owns its policy and per-response nonce. Do not guess one,
      // widen directives, or inject a blocked inline client into an enforced-CSP page.
      /** Existing bounded complete identity-HTML eligibility gate, excluding committed/CSP/bodyless responses. */
      const shouldInject =
        !hasEnforcedCsp &&
        !res.headersSent &&
        bytes <= MAX_INJECTED_HTML_BYTES &&
        /(?:^|\s|;)text\/html(?:\s*;|$)/.test(contentType) &&
        (!contentEncoding || contentEncoding === 'identity') &&
        res.statusCode !== 204 &&
        res.statusCode !== 304;
      if (!shouldInject) {
        flushBuffered();
        return end(typeof encoding === 'function' ? encoding : callback);
      }
      /** Complete eligible buffered UTF-8 document passed only to the trusted devtools injection encoder. */
      const html = Buffer.concat(chunks, bytes).toString('utf8');
      /** Encoded development-client HTML; only the transformed content length is emitted. */
      const transformed = injectDevClient(html, options);
      restore();
      res.removeHeader('transfer-encoding');
      setHeader('content-length', Buffer.byteLength(transformed));
      return end(
        transformed,
        'utf8',
        typeof encoding === 'function' ? encoding : callback
      );
    }) as typeof res.end;
    try {
      await handler(req, res);
    } catch (error) {
      // Leave the response object usable by an outer error handler.
      restore();
      throw error;
    }
  };
}
