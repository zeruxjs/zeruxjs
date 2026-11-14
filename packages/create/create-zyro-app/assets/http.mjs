import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { createSecurityPolicy } from '@zeruxjs/security/policy';
/** Start the explicit loopback preview with manifest-listed files and fixed response policy.
 * @param {object} options - Trusted generated output/configuration, never request-selected paths.
 * @param {string} options.directory - Fixed build output root.
 * @param {object} options.config - Validated public mode/port/mount settings.
 * @param {string[]} options.files - Manifest-listed relative asset paths.
 * @param {Function} options.render - Optional trusted SSR callback.
 * @param {string} options.notFound - Explicit built missing-page output path.
 * @returns {import('node:http').Server} Owned loopback server; terminal handlers close only this preview.
 */
export function serve({ directory, config, files, render, notFound }) {
  /** Response-owned security header policy for the explicit generated mode. */
  const policy = createSecurityPolicy({
    mode: 'production',
    resources: {
      'style-src': ["'self'"],
      ...(['client', 'hydrated'].includes(config.mode)
        ? { 'script-src': ["'self'"] }
        : {}),
    },
  });
  /** Canonical mount prefix; root mode uses an empty join prefix. */
  const base = config.basePath === '/' ? '' : config.basePath;
  /** Only manifest-listed output files may be served by request path. */
  const mappings = new Map(files.map((file) => ['/' + file, file]));
  /** Read only bounded regular files while rejecting traversal and symlink components.
   * @param {string} file - Manifest-selected relative output path.
   * @returns {Buffer} Bounded bytes; the descriptor always closes.
   */
  function read(file) {
    if (
      !file ||
      file.split('/').some((p) => !p || p === '.' || p === '..') ||
      file.includes('\\')
    ) {
      throw Error('Invalid asset path');
    }
    let location = directory;
    for (const part of file.split('/').slice(0, -1)) {
      location = path.join(location, part);
      if (fs.lstatSync(location).isSymbolicLink()) {
        throw Error('Symlink asset rejected');
      }
    }
    location = path.join(location, file.split('/').at(-1));
    /** Owned no-follow nonblocking descriptor; finally closes it after bounded reads. */
    const fd = fs.openSync(
      location,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK
    );
    try {
      /** Descriptor metadata checked for a regular bounded file before allocation. */
      const info = fs.fstatSync(fd);
      if (!info.isFile() || info.size > 2097152) {
        throw Error('Asset limit');
      }
      /** Bounded read buffer with one extra byte to detect growth during reading. */
      const buffer = Buffer.alloc(info.size + 1);
      /** Actual bytes read, checked against the previously observed file size. */
      const size = fs.readSync(fd, buffer, 0, buffer.length, 0);
      if (size > info.size) {
        throw Error('Asset changed during read');
      }
      return buffer.subarray(0, size);
    } finally {
      fs.closeSync(fd);
    }
  }
  /** Owned loopback preview server; explicitly configured finite connection/time budgets. */
  const server = createServer(async (req, res) => {
    for (const [key, value] of Object.entries(
      policy.createResponse().headers
    )) {
      res.setHeader(key, value);
    }
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');
    if (!['GET', 'HEAD'].includes(req.method ?? '')) {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      /** Request path parsed against a fixed dummy origin; forwarded origins are ignored. */
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (base && pathname === base) {
        res.writeHead(308, { location: base + '/' }).end();
        return;
      }
      let body,
        type = 'text/html; charset=utf-8',
        status = 200;
      if (pathname === (base || '') + '/') {
        body = render
          ? await render()
          : read((base ? base.slice(1) + '/' : '') + 'index.html');
      } else if (notFound && pathname === '/' + notFound) {
        status = 404;
        body = read(notFound);
      } else if (mappings.has(pathname)) {
        /** Manifest-listed local asset; only documented static extensions are served. */
        const file = mappings.get(pathname);
        if (!/\.(?:css|js|txt|svg)$/.test(file)) {
          throw Error('Unserved file');
        }
        body = read(file);
        if (file.endsWith('.css')) {
          type = 'text/css; charset=utf-8';
        } else if (file.endsWith('.js')) {
          type = 'text/javascript; charset=utf-8';
        } else if (file.endsWith('.svg')) {
          type = 'image/svg+xml';
        } else {
          type = 'text/plain; charset=utf-8';
        }
      } else {
        status = 404;
        body = notFound ? read(notFound) : 'Not found';
      }
      res.writeHead(status, {
        'content-type': type,
        'content-length': Buffer.byteLength(body),
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res
        .writeHead(500, { 'content-type': 'text/plain' })
        .end('Unable to serve output');
    }
  });
  server.maxConnections = 64;
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  server.keepAliveTimeout = 5000;
  /** Begin bounded preview shutdown and remove process listeners after the server settles.
   * @returns {void} Stops accepting connections; lingering owned sockets close after the deadline.
   */
  const stop = () => {
    /** Owned close deadline that ends lingering preview sockets and is cleared after close. */
    const timer = setTimeout(() => server.closeAllConnections(), 1000);
    timer.unref();
    server.close(() => {
      clearTimeout(timer);
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  server.once('error', (error) => {
    process.off('SIGINT', stop);
    process.off('SIGTERM', stop);
    console.error(
      error.code === 'EADDRINUSE'
        ? 'Port unavailable. Choose another configured port; no process was stopped.'
        : 'Unable to start preview server'
    );
    process.exitCode = 1;
  });
  server.listen(config.port, '127.0.0.1', () =>
    console.log(
      'Zyro ready http://127.0.0.1:' + config.port + (base || '') + '/'
    )
  );
  return server;
}
