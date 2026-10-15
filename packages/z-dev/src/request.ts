import type { IncomingMessage } from 'node:http';

export class RequestBodyError extends Error {
  constructor(message: string, readonly statusCode: number) { super(message); this.name = 'RequestBodyError'; }
}

/** Stream bytes with a strict cap and predictable listener cleanup. */
export function readLimitedBody(req: IncomingMessage, limit = 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const cleanup = () => {
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAbort);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      req.pause();
      reject(error);
    };
    const onData = (chunk: Buffer | string) => {
      const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += data.length;
      if (size > limit) return fail(new RequestBodyError('Devtools request body too large', 413));
      chunks.push(data);
    };
    const onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks, size));
    };
    const onError = (error: Error) => fail(error);
    const onAbort = () => fail(new RequestBodyError('Request aborted', 400));
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('aborted', onAbort);
  });
}

export function localDevHost(host: string): boolean {
  if (!host || /[\s\\/@?#,]/.test(host)) return false;
  try {
    const url = new URL(`http://${host}`);
    if (url.username || url.password || url.pathname !== '/') return false;
    const name = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    return name === 'localhost' || name.endsWith('.localhost') || name === '127.0.0.1' || name === '::1';
  } catch { return false; }
}
