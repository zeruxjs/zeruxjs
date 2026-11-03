import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { createSecurityPolicy } from '@zeruxjs/security/policy';
export function serve({ directory, config, files, render, notFound }) {
  const policy = createSecurityPolicy({
      mode: 'production',
      resources: {
        'style-src': ["'self'"],
        ...(['client', 'hydrated'].includes(config.mode)
          ? { 'script-src': ["'self'"] }
          : {}),
      },
    }),
    base = config.basePath === '/' ? '' : config.basePath;
  const mappings = new Map(files.map((file) => ['/' + file, file]));
  function read(file) {
    if (
      !file ||
      file.split('/').some((p) => !p || p === '.' || p === '..') ||
      file.includes('\\')
    )
      throw Error('Invalid asset path');
    let location = directory;
    for (const part of file.split('/').slice(0, -1)) {
      location = path.join(location, part);
      if (fs.lstatSync(location).isSymbolicLink())
        throw Error('Symlink asset rejected');
    }
    location = path.join(location, file.split('/').at(-1));
    const fd = fs.openSync(location, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const info = fs.fstatSync(fd);
      if (!info.isFile() || info.size > 2097152) throw Error('Asset limit');
      const buffer = Buffer.alloc(info.size + 1), size = fs.readSync(fd, buffer, 0, buffer.length, 0);
      if (size > info.size) throw Error('Asset changed during read');
      return buffer.subarray(0, size);
    } finally {fs.closeSync(fd);}

  }
  const server = createServer(async (req, res) => {
    for (const [key, value] of Object.entries(policy.createResponse().headers))
      res.setHeader(key, value);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');
    if (!['GET', 'HEAD'].includes(req.method ?? '')) {
      res.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      if (base && pathname === base) {
        res.writeHead(308, { location: base + '/' }).end();
        return;
      }
      let body,
        type = 'text/html; charset=utf-8',
        status = 200;
      if (pathname === (base || '') + '/')
        body = render
          ? await render()
          : read((base ? base.slice(1) + '/' : '') + 'index.html');
      else if (notFound && pathname === '/' + notFound) {
        status = 404;
        body = read(notFound);
      } else if (mappings.has(pathname)) {
        const file = mappings.get(pathname);
        if (!/\.(?:css|js|txt|svg)$/.test(file)) throw Error('Unserved file');
        body = read(file);
        type = file.endsWith('.css')
          ? 'text/css; charset=utf-8'
          : file.endsWith('.js')
            ? 'text/javascript; charset=utf-8'
            : file.endsWith('.svg')
              ? 'image/svg+xml'
              : 'text/plain; charset=utf-8';
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
  const stop = () => {
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
        : 'Unable to start preview server',
    );
    process.exitCode = 1;
  });
  server.listen(config.port, '127.0.0.1', () =>
    console.log(
      'Zyro ready http://127.0.0.1:' + config.port + (base || '') + '/',
    ),
  );
  return server;
}
