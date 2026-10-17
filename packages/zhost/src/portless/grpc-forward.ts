import * as http2 from 'node:http2';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { filterProxyHeaders } from './proxy-headers.js';
import { parseAuthority } from './request-security.js';

/**
 * gRPC is an HTTP/2 wire protocol, not JSON or HTTP/1.1 upgrade traffic.
 * Preserve frames, request authority, trailers and streaming backpressure when
 * forwarding to the loopback h2c application server. Every session is scoped
 * to one request and is closed when either peer disconnects.
 */
export function forwardGrpc(req: IncomingMessage, res: ServerResponse, port: number, headers: Record<string, string>, feedback: { success?: () => void; failure?: () => void } = {}): void {
  if (req.httpVersionMajor < 2) {
    res.writeHead(426, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end('gRPC requires HTTP/2');
    return;
  }
  const rawAuthority = headers['x-forwarded-host'] ?? req.headers[':authority'] ?? req.headers.host;
  const authority = typeof rawAuthority === 'string' ? parseAuthority(rawAuthority) : null;
  if (!authority || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    res.writeHead(400, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    res.end('Invalid gRPC upstream authority');
    return;
  }
  const client = http2.connect(`http://127.0.0.1:${port}`);
  let finished = false;
  let replied = false;
  let outcomeRecorded = false;
  const record = (ok: boolean) => {
    if (outcomeRecorded) return;
    outcomeRecorded = true;
    try { if (ok) feedback.success?.(); else feedback.failure?.(); } catch { /* Circuit health callbacks must never interrupt streams. */ }
  };
  const close = () => {
    if (finished) return;
    finished = true;
    client.close();
  };
  const fail = () => {
    if (finished) return;
    record(false);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      res.end('Bad Gateway');
    } else res.destroy();
    close();
  };
  const forwarded = filterProxyHeaders(headers);
  delete forwarded.host;
  delete forwarded.te; // This hop explicitly negotiates HTTP/2 trailers.
  const outgoing = client.request({
    ':method': req.method ?? 'POST', ':path': req.url ?? '/',
    ':authority': rawAuthority as string,
    ...forwarded, te: 'trailers',
  });
  outgoing.setTimeout(30_000, () => outgoing.close(http2.constants.NGHTTP2_CANCEL));
  outgoing.on('response', upstreamHeaders => {
    if (finished || res.destroyed) return;
    replied = true;
    record(true);
    const status = Number(upstreamHeaders[':status'] ?? 502);
    const cleaned = filterProxyHeaders(upstreamHeaders);
    delete cleaned.te;
    if (!res.headersSent) res.writeHead(status, cleaned);
  });
  outgoing.on('trailers', trailers => {
    if (finished || res.destroyed) return;
    const safe = filterProxyHeaders(trailers);
    if (typeof res.addTrailers === 'function') res.addTrailers(safe);
  });
  outgoing.on('error', fail);
  outgoing.once('close', () => {
    // An HTTP/2 stream can close after RST_STREAM without an 'end' event.
    if (!finished && !replied) fail();
    else if (!finished) { if (!res.writableEnded) res.destroy(); close(); }
  });
  client.on('error', fail);
  outgoing.on('end', () => { if (!res.destroyed) res.end(); close(); });
  outgoing.pipe(res, { end: false });
  req.pipe(outgoing);
  req.once('aborted', () => { outgoing.close(http2.constants.NGHTTP2_CANCEL); close(); });
  res.once('close', () => { outgoing.close(http2.constants.NGHTTP2_CANCEL); close(); });
}
