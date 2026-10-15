import { injectDevClient, isPrimaryHtmlRequest } from 'z-dev';
import type { IncomingMessage, ServerResponse } from 'node:http';

/** Only buffer small, identity-encoded HTML pages. Large pages and streaming
 * responses are passed through byte-for-byte without client injection. */
export const MAX_INJECTED_HTML_BYTES = 2 * 1024 * 1024;
export interface DevInjectionOptions {
  serviceName: string;
  routeName: string;
  devServerUrl: string;
  allowedDevDomain?: string | null;
  devPortLessAlias: { value: string | null | false };
}

export function createInjectedAppHandler(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void,
  options: DevInjectionOptions,
) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    if (!isPrimaryHtmlRequest(req)) return handler(req, res);

    const writeHead = res.writeHead.bind(res);
    const write = res.write.bind(res);
    const end = res.end.bind(res);
    const setHeader = res.setHeader.bind(res);
    const chunks: Buffer[] = [];
    let bytes = 0;
    let passthrough = false;
    let ended = false;

    function restore(): void {
      res.writeHead = writeHead as typeof res.writeHead;
      res.write = write as typeof res.write;
      res.end = end as typeof res.end;
      res.setHeader = setHeader as typeof res.setHeader;
    }
    function flushBuffered(): void {
      if (passthrough) return;
      passthrough = true;
      restore();
      for (const buffer of chunks) write(buffer);
      chunks.length = 0;
    }
    // writeHead can be called before the last chunk; defer it only until
    // the point at which headers/body are actually sent.
    res.writeHead = ((status: number, reasonOrHeaders?: any, maybeHeaders?: any) => {
      res.statusCode = status;
      const supplied = typeof reasonOrHeaders === 'string' ? maybeHeaders : reasonOrHeaders;
      if (supplied && !Array.isArray(supplied)) {
        for (const [name, value] of Object.entries(supplied)) {
          if (value !== undefined) setHeader(name, value as string | number | readonly string[]);
        }
      }
      return res;
    }) as typeof res.writeHead;
    res.write = ((chunk: any, encoding?: any, callback?: any) => {
      if (passthrough) return write(chunk, encoding, callback);
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding as BufferEncoding : undefined);
      chunks.push(buffer);
      bytes += buffer.length;
      if (bytes > MAX_INJECTED_HTML_BYTES) flushBuffered();
      const cb = typeof encoding === 'function' ? encoding : callback;
      if (typeof cb === 'function') cb();
      return !res.writableNeedDrain;
    }) as typeof res.write;
    res.end = ((chunk?: any, encoding?: any, callback?: any) => {
      if (ended) return res;
      ended = true;
      if (passthrough) return end(chunk, encoding, callback);
      if (chunk !== undefined && chunk !== null) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof encoding === 'string' ? encoding as BufferEncoding : undefined);
        chunks.push(buffer);
        bytes += buffer.length;
      }
      const contentType = String(res.getHeader('content-type') ?? '').toLowerCase();
      const contentEncoding = String(res.getHeader('content-encoding') ?? '').toLowerCase();
      const shouldInject = bytes <= MAX_INJECTED_HTML_BYTES && /(?:^|\s|;)text\/html(?:\s*;|$)/.test(contentType) &&
        (!contentEncoding || contentEncoding === 'identity') && res.statusCode !== 204 && res.statusCode !== 304;
      if (!shouldInject) {
        flushBuffered();
        return end(typeof encoding === 'function' ? encoding : callback);
      }
      const html = Buffer.concat(chunks, bytes).toString('utf8');
      const transformed = injectDevClient(html, options);
      restore();
      res.removeHeader('transfer-encoding');
      setHeader('content-length', Buffer.byteLength(transformed));
      return end(transformed, 'utf8', typeof encoding === 'function' ? encoding : callback);
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
