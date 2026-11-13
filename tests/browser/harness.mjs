import { createServer } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
/** Test fixture or local value named exec. */
const exec = promisify(execFile);
/** Test fixture or local value named root. */
const root = resolve(import.meta.dirname, '../..');
/** Test fixture or local value named mime. */
const mime = {
  '.js': 'text/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};
/**
 * Serve one browser fixture from an isolated loopback HTTP server.
 *
 * @param {string} filename - Fixture filename relative to the browser fixtures directory.
 * @param {(url: string) => Promise<unknown>} run - Callback invoked with the fixture URL.
 * @returns {Promise<unknown>} The callback result after the server is closed.
 */
export async function withBrowserFixture(filename, run) {
  /** Test fixture or local value named fixture. */
  const fixture = resolve(root, 'tests/browser/fixtures', filename);
  /** Test fixture or local value named server. */
  const server = createServer(async (req, res) => {
    try {
      if (req.method !== 'GET') {
        res.writeHead(405).end();
        return;
      }
      /** Test fixture or local value named pathname. */
      const pathname = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      /** Test fixture or local value named destination. */
      const destination =
        pathname === '/' ? fixture : resolve(root, '.' + pathname);
      /** Test fixture or local value named actual. */
      const actual = await realpath(destination);
      if (!actual.startsWith(root + sep) || !/\.(html|js|css)$/.test(actual)) {
        res.writeHead(403).end();
        return;
      }
      /** Test fixture or local value named body. */
      const body = await readFile(actual);
      res
        .writeHead(200, {
          'content-type': mime[extname(actual)],
          'cache-control': 'no-store',
          'content-security-policy':
            "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'",
        })
        .end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', ok);
  });
  try {
    return await run(`http://127.0.0.1:${server.address().port}/`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}
/**
 * Execute Chromium in headless dump-dom mode and decode the fixture result.
 *
 * @param {string} url - Loopback fixture URL to load.
 * @param {{binary?: string, timeout?: number, flags?: string[]}} options - Browser executable and process options.
 * @returns {Promise<unknown>} Parsed JSON returned by the browser fixture.
 */
export async function runChromium(
  url,
  {
    binary = process.env.CHROMIUM_BIN ?? 'chromium',
    timeout = 20000,
    flags = [],
  } = {}
) {
  /** Captured browser process output used to decode the fixture result. */
  const { stdout, stderr } = await exec(
    binary,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--virtual-time-budget=2000',
      ...flags,
      '--dump-dom',
      url,
    ],
    { timeout, maxBuffer: 1024 * 1024 * 3 }
  );
  /** Test fixture or local value named match. */
  const match = stdout.match(
    /<output id="browser-result"[^>]*>([\s\S]*?)<\/output>/
  );
  if (!match)
    throw new Error(
      'Browser did not produce a result: ' +
        stdout.slice(-700) +
        ' ' +
        stderr.slice(-300)
    );
  /** Test fixture or local value named result. */
  const result = JSON.parse(
    match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&')
  );
  return result;
}
