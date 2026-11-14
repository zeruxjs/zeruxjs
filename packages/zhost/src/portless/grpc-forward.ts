import * as http2 from 'node:http2';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { filterProxyHeaders } from './proxy-headers.js';
import { parseAuthority } from './request-security.js';

/** Forward one native HTTP/2 request to a validated loopback h2c backend, preserving frames/trailers and stream backpressure without retries.
 * @param {IncomingMessage} req - Borrowed incoming request; source abort closes the owned upstream stream.
 * @param {ServerResponse} res - Borrowed serving response; downstream close cancels the owned upstream stream.
 * @param {number} port - Validated private backend port; never a model/client-selected URL.
 * @param {Record<string, string>} headers - Serving-proxy reconstructed peer headers; untrusted forwarding chains were removed.
 * @param {{ success?: () => void; failure?: () => void }} feedback - Optional trusted best-effort circuit observation callbacks.
 * @param {(() => void) | undefined} feedback.success - Best-effort trusted circuit callback when native response headers arrive.
 * @param {(() => void) | undefined} feedback.failure - Best-effort trusted circuit callback for native transport failure.
 * @returns {void} Owns a per-request upstream session through peer/end/error cleanup; it is forwarding, not native service registration.
 */
export function forwardGrpc(
  req: IncomingMessage,
  res: ServerResponse,
  port: number,
  headers: Record<string, string>,
  feedback: { success?: () => void; failure?: () => void } = {}
): void {
  if (req.httpVersionMajor < 2) {
    res.writeHead(426, {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-store',
    });
    res.end('gRPC requires HTTP/2');
    return;
  }
  /** Serving-proxy authority preferred over the already parsed native request authority. */
  const rawAuthority =
    headers['x-forwarded-host'] ??
    req.headers[':authority'] ??
    req.headers.host;
  /** Validated authority used only for routing/forwarding, not destination authorization. */
  const authority =
    typeof rawAuthority === 'string' ? parseAuthority(rawAuthority) : null;
  if (!authority || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    res.writeHead(400, {
      'Content-Type': 'text/plain',
      'Cache-Control': 'no-store',
    });
    res.end('Invalid gRPC upstream authority');
    return;
  }
  /** Owned per-request loopback HTTP/2 session, closed on stream/peer termination. */
  const client = http2.connect(`http://127.0.0.1:${port}`);
  let finished = false;
  let replied = false;
  let outcomeRecorded = false;
  /** Record one best-effort native transport outcome without interrupting byte flow.
   * @param {boolean} ok Whether response headers arrived successfully.
   * @returns {void} Invokes at most one host callback, isolating callback exceptions. */
  const record = (ok: boolean) => {
    if (outcomeRecorded) {
      return;
    }
    outcomeRecorded = true;
    try {
      if (ok) {
        feedback.success?.();
      } else {
        feedback.failure?.();
      }
    } catch {
      /* Circuit health callbacks must never interrupt streams. */
    }
  };
  /** Fence this forwarding lifetime and request native session close once.
   * @returns {void} Does not claim native session close has already settled. */
  const close = () => {
    if (finished) {
      return;
    }
    finished = true;
    client.close();
  };
  /** Record transport failure and end an uncommitted response or destroy a committed one.
   * @returns {void} Cancels this forwarding lifetime without replaying bytes. */
  const fail = () => {
    if (finished) {
      return;
    }
    record(false);
    if (!res.headersSent) {
      res.writeHead(502, {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-store',
      });
      res.end('Bad Gateway');
    } else {
      res.destroy();
    }
    close();
  };
  /** Detached hop-filtered fields; this HTTP/2 hop separately negotiates trailers. */
  const forwarded = filterProxyHeaders(headers);
  delete forwarded.host;
  delete forwarded.te; // This hop explicitly negotiates HTTP/2 trailers.
  /** Owned single HTTP/2 upstream stream; no partially forwarded request is retried. */
  const outgoing = client.request({
    ':method': req.method ?? 'POST',
    ':path': req.url ?? '/',
    ':authority': rawAuthority as string,
    ...forwarded,
    te: 'trailers',
  });
  outgoing.setTimeout(30_000, () =>
    outgoing.close(http2.constants.NGHTTP2_CANCEL)
  );
  outgoing.on('response', (upstreamHeaders) => {
    if (finished || res.destroyed) {
      return;
    }
    replied = true;
    record(true);
    /** Native upstream response status, defaulting missing status to Bad Gateway. */
    const status = Number(upstreamHeaders[':status'] ?? 502);
    /** Detached permitted response fields without forbidden HTTP/2 hop metadata. */
    const cleaned = filterProxyHeaders(upstreamHeaders);
    delete cleaned.te;
    if (!res.headersSent) {
      res.writeHead(status, cleaned);
    }
  });
  outgoing.on('trailers', (trailers) => {
    if (finished || res.destroyed) {
      return;
    }
    /** Detached permitted upstream trailers forwarded only while the response remains live. */
    const safe = filterProxyHeaders(trailers);
    if (typeof res.addTrailers === 'function') {
      res.addTrailers(safe);
    }
  });
  outgoing.on('error', fail);
  outgoing.once('close', () => {
    // An HTTP/2 stream can close after RST_STREAM without an 'end' event.
    if (!finished && !replied) {
      fail();
    } else if (!finished) {
      if (!res.writableEnded) {
        res.destroy();
      }
      close();
    }
  });
  client.on('error', fail);
  outgoing.on('end', () => {
    if (!res.destroyed) {
      res.end();
    }
    close();
  });
  outgoing.pipe(res, { end: false });
  req.pipe(outgoing);
  req.once('aborted', () => {
    outgoing.close(http2.constants.NGHTTP2_CANCEL);
    close();
  });
  res.once('close', () => {
    outgoing.close(http2.constants.NGHTTP2_CANCEL);
    close();
  });
}
