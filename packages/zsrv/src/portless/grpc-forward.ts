import * as http2 from 'node:http2';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { filterProxyHeaders } from './proxy-headers.js';
/** gRPC requires HTTP/2 streaming and trailers. Forward its wire frames unchanged to an h2c backend.
 * Intended for actual gRPC servers rather than converting messages to JSON. */
export function forwardGrpc(req: IncomingMessage, res: ServerResponse, port: number, headers: Record<string, string>): void {
  if (req.httpVersionMajor < 2) {
    res.writeHead(426, { 'Content-Type': 'text/plain' }); res.end('gRPC requires HTTP/2'); return;
  }
  const client = http2.connect(`http://127.0.0.1:${port}`);
  let finished = false;
  const close = () => { if (finished) return; finished = true; client.close(); };
  const outgoing = client.request({ ':method': req.method ?? 'POST', ':path': req.url ?? '/', ...headers, 'te': 'trailers' });
  outgoing.setTimeout(30_000, () => outgoing.close(http2.constants.NGHTTP2_CANCEL));
  outgoing.on('response', upstreamHeaders => {
    const status = Number(upstreamHeaders[':status'] ?? 200);
    const cleaned = filterProxyHeaders(upstreamHeaders);
    delete cleaned['te'];
    if (!res.headersSent) res.writeHead(status, cleaned);
  });
  outgoing.on('trailers', trailers => {
    const safe = filterProxyHeaders(trailers);
    if (typeof res.addTrailers === 'function') res.addTrailers(safe);
  });
  outgoing.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); close(); });
  client.on('error', () => { outgoing.close(); if (!res.headersSent) res.writeHead(502); res.end(); close(); });
  outgoing.on('end', () => { res.end(); close(); });
  outgoing.pipe(res, { end: false });
  req.pipe(outgoing);
  res.once('close', () => { outgoing.close(); close(); });
}
