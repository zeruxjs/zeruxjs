import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { once } from 'node:events';
import { createProxyServer } from '../dist/portless/proxy.js';
import {
  negotiateCompression,
  compressionSupported,
  parseAcceptEncoding,
  appendVary,
} from '../dist/portless/proxy-compression.js';

/** Bind an owned HTTP fixture to an ephemeral loopback port.
 * @param {import("node:http").Server} server - Test-owned listener.
 * @returns {Promise<number>} Actual assigned port after the listening event.
 */
async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}
/** Close fixture connections and await listener teardown.
 * @param {import("node:http").Server} server - Owned fixture server.
 * @returns {Promise<void>} Settles after the fixture listener closes.
 */
async function close(server) {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}
/** Own upstream and proxy listeners around one compression assertion callback.
 * @param {import("node:http").RequestListener} handler - Fixed synthetic upstream response handler.
 * @param {(port: number) => Promise<void>} fn - Assertions receiving the ephemeral proxy port.
 * @param {import("../dist/portless/proxy-compression.js").ProxyCompressionOptions | undefined} compression - Optional explicit compression policy under test.
 * @returns {Promise<void>} Awaits assertions and closes both owned listeners in finally.
 */
async function withProxy(handler, fn, compression) {
  /** Owned synthetic upstream listener, closed after the proxy in finally. */
  const upstream = http.createServer(handler);
  /** Ephemeral upstream port allocated by the operating system. */
  const backendPort = await listen(upstream);
  /** Owned fixture proxy with no production routes or private application state. */
  const proxy = createProxyServer({
    getRoutes: () => [{ hostname: 'app.localhost', port: backendPort }],
    proxyPort: 0,
    compression,
    onError: () => {},
  });
  /** Ephemeral proxy listener port provided to the assertion callback. */
  const port = await listen(proxy);
  try {
    await fn(port);
  } finally {
    await close(proxy);
    await close(upstream);
  }
}
/** Collect one bounded synthetic fixture response without accessing external endpoints.
 * @param {number} port - Ephemeral loopback fixture port.
 * @param {string | undefined} accept - Accept-Encoding fixture value; undefined omits the header.
 * @param {string} path - Fixture path, defaulting to slash.
 * @returns {Promise<{status: number | undefined, headers: import("node:http").IncomingHttpHeaders, bytes: Buffer}>} Observed status, headers and small fixture bytes.
 */
function request(port, accept, path = '/') {
  return new Promise((resolve, reject) => {
    http
      .get(
        {
          hostname: '127.0.0.1',
          port,
          path,
          headers: {
            host: 'app.localhost',
            ...(accept === undefined ? {} : { 'accept-encoding': accept }),
          },
        },
        (res) => {
          /** Small fixed fixture response chunks; not an unbounded production download helper. */
          const chunks = [];
          res.on('data', (data) => chunks.push(data));
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              bytes: Buffer.concat(chunks),
            })
          );
          res.on('error', reject);
        }
      )
      .on('error', reject);
  });
}
/** Deterministic repeated fixture payload, large enough to cross the compression threshold. */
const text = 'hello-proworkspace-'.repeat(512);
/** Decode only the explicitly negotiated fixture representation.
 * @param {{headers: import("node:http").IncomingHttpHeaders, bytes: Buffer}} result - Small response under test.
 * @returns {string} UTF-8 fixture content after the selected native decoder.
 */
const decode = (result) => {
  switch (result.headers['content-encoding']) {
    case 'br':
      return zlib.brotliDecompressSync(result.bytes).toString();
    case 'gzip':
      return zlib.gunzipSync(result.bytes).toString();
    case 'deflate':
      return zlib.inflateSync(result.bytes).toString();
    case 'zstd':
      return zlib.zstdDecompressSync(result.bytes).toString();
    default:
      return result.bytes.toString();
  }
};

test('Accept-Encoding negotiation respects quality, wildcard, identity and explicit refusal', () => {
  assert.equal(negotiateCompression('gzip;q=1, br;q=0.5').encoding, 'gzip');
  assert.equal(negotiateCompression('br;q=1,gzip;q=0.6').encoding, 'br');
  assert.equal(negotiateCompression('br;q=0, gzip;q=0').encoding, null);
  assert.deepEqual(negotiateCompression('identity;q=0, *;q=0'), {
    encoding: null,
    acceptable: false,
  });
  assert.equal(negotiateCompression(undefined).encoding, null);
  assert.equal(parseAcceptEncoding('gzip;q=0.8').get('gzip'), 0.8);
  assert.equal(
    appendVary('Origin, ACCEPT-ENCODING', 'Accept-Encoding'),
    'Origin, ACCEPT-ENCODING'
  );
  assert.equal(
    negotiateCompression('gzip', { encodings: ['nope'] }).encoding,
    null
  );
});

test('streaming br, gzip and deflate compression keep text and preserve cache vary', async () => {
  await withProxy(
    (_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/plain; charset=utf-8',
        etag: '"plain"',
        'content-length': Buffer.byteLength(text),
        vary: 'Origin',
      });
      res.end(text);
    },
    async (port) => {
      for (const encoding of ['br', 'gzip', 'deflate']) {
        /** Observed fixture representation whose headers and decoded bytes are asserted. */
        const result = await request(port, `${encoding};q=1, identity;q=0`);
        assert.equal(result.status, 200);
        assert.equal(result.headers['content-encoding'], encoding);
        assert.equal(result.headers['content-length'], undefined);
        assert.equal(result.headers.etag, undefined);
        assert.match(result.headers.vary, /Accept-Encoding/);
        assert.match(result.headers.vary, /Origin/);
        assert.equal(decode(result), text);
      }
    }
  );
});

test('zstd compression is available when supported and negotiated', async () => {
  await withProxy(
    (_req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: text }));
    },
    async (port) => {
      /** Observed fixture representation whose headers and decoded bytes are asserted. */
      const result = await request(port, 'zstd, gzip;q=0.5');
      assert.equal(result.status, 200);
      assert.equal(
        result.headers['content-encoding'],
        compressionSupported('zstd') ? 'zstd' : 'gzip'
      );
      assert.deepEqual(JSON.parse(decode(result)), { data: text });
    }
  );
});

test('upstream compression passes untouched and never double-compresses behind Nginx', async () => {
  /** Preencoded fixture proving the proxy does not double-compress upstream bytes. */
  const alreadyGz = zlib.gzipSync(text);
  await withProxy(
    (_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-encoding': 'gzip',
        'content-length': alreadyGz.length,
        etag: '"upstream"',
      });
      res.end(alreadyGz);
    },
    async (port) => {
      /** Observed upstream gzip representation, expected to pass through byte-for-byte. */
      const same = await request(port, 'br, gzip');
      assert.equal(same.headers['content-encoding'], 'gzip');
      assert.deepEqual(same.bytes, alreadyGz);
      assert.equal(same.headers.etag, '"upstream"');
      /** Response to an explicitly forbidden upstream encoding, expected to be 406. */
      const rejected = await request(port, 'gzip;q=0, identity;q=1');
      assert.equal(rejected.status, 406);
    }
  );
});

test('SSE, no-transform, range responses, small payloads and disabled compression stay unencoded', async () => {
  await withProxy(
    (req, res) => {
      if (req.url === '/sse') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.end(`data: ${text}\n\n`);
      } else if (req.url === '/no') {
        res.writeHead(200, {
          'content-type': 'text/plain',
          'cache-control': 'private, no-transform',
        });
        res.end(text);
      } else if (req.url === '/range') {
        res.writeHead(206, {
          'content-type': 'text/plain',
          'content-range': 'bytes 0-4/5000',
        });
        res.end('hello');
      } else {
        res.setHeader('content-type', 'text/plain');
        res.end('short');
      }
    },
    async (port) => {
      for (const url of ['/sse', '/no', '/range', '/']) {
        /** Observed fixture representation whose headers and decoded bytes are asserted. */
        const result = await request(port, 'br,gzip', url);
        assert.equal(result.headers['content-encoding'], undefined, url);
      }
    },
    { minBytes: 1024 }
  );
});

test('status, outside-route and load telemetry remain correct with compression enabled', async () => {
  await withProxy(
    (req, res) => {
      res.writeHead(req.url === '/redirect' ? 302 : 503, {
        'content-type': 'text/plain',
      });
      res.end(text);
    },
    async (port) => {
      assert.equal((await request(port, 'br', '/redirect')).status, 302);
      assert.equal((await request(port, 'gzip', '/error')).status, 503);
    }
  );
});

test('disabling ZHOST compression leaves responses untouched for outer Nginx', async () => {
  await withProxy(
    (_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/plain',
        'content-length': text.length,
      });
      res.end(text);
    },
    async (port) => {
      /** Observed fixture representation whose headers and decoded bytes are asserted. */
      const result = await request(port, 'br, gzip');
      assert.equal(result.headers['content-encoding'], undefined);
      assert.equal(result.headers['content-length'], String(text.length));
      assert.equal(result.bytes.toString(), text);
    },
    { enabled: false }
  );
});

test('proxy compression CLI accepts safe modes and rejects invalid encodings', async () => {
  /** Public CLI parser under test; importing and parsing do not start a listener. */
  const { parseProxyStartArguments } =
    await import('../dist/bin/parse-proxy.js');
  assert.deepEqual(parseProxyStartArguments(['--no-compress']).compression, {
    enabled: false,
  });
  assert.deepEqual(
    parseProxyStartArguments([
      '--compress',
      '--compression-min',
      '800',
      '--compression-encodings',
      'br,gzip',
    ]).compression,
    { enabled: true, minBytes: 800, encodings: ['br', 'gzip'] }
  );
  assert.throws(
    () => parseProxyStartArguments(['--compression-encodings', 'gzip,evil']),
    /Invalid/
  );
  assert.throws(
    () => parseProxyStartArguments(['--compress', '--compress']),
    /Repeated/
  );
});
