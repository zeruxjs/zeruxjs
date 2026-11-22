import path from 'node:path';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import type { StaticExportOptions } from '../static-export.js';
import { createStaticSiteHandler } from '../static-site.js';
import { sendFetchResponse } from '../fetch-route.js';

/** Load an explicitly trusted project export module; never bootstrap private application services.
 * @param {string} rootDir - Trusted CLI project root, default current directory.
 * @returns {Promise<unknown>} Existing exporter completion receipt.
 */
export async function exportProject(rootDir = process.cwd()) {
  /** Explicit project root; export modules are trusted executable configuration. */
  const root = await fs.realpath(rootDir);
  for (const name of ['zerux.static.js', 'zerux.static.ts']) {
    /** Fixed allowlisted configuration filenames, never request-derived imports. */
    const file = path.join(root, name);
    /** Fixed config must be a regular project file; absence tries the next supported extension. */
    const stat = await fs.lstat(file).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      return undefined;
    });
    if (!stat) {
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new TypeError('Unsafe static export config');
    }
    /** Host-authored functions are permitted only through explicit local CLI configuration. */
    const loaded = await import(pathToFileURL(file).href);
    if (
      !loaded.default ||
      typeof loaded.default !== 'object' ||
      Array.isArray(loaded.default)
    ) {
      throw new TypeError('Static config must default-export options');
    }
    /** Optional parser dependency is acquired only for the explicit export command. */
    const { exportStaticSite } = await import('../static-export.js');
    /** Existing exporter validates and publishes the entire public candidate. */
    const manifest = await exportStaticSite({
      ...loaded.default,
      rootDir: root,
    } as StaticExportOptions<unknown>);
    console.info(
      `[zerux export] Exported ${manifest.pages.length} public pages`
    );
    return manifest;
  }
  throw new Error(
    'Create zerux.static.ts or zerux.static.js with explicit public export options'
  );
}
/** Start an explicit public-output server without starting runtime services or the portless proxy.
 * @param {Record<string,unknown>} args - CLI dir, port/p and host options.
 * @returns {Promise<import('node:http').Server>} Owned native server; caller closes it on teardown.
 */
export async function serveStaticProject(args: Record<string, unknown> = {}) {
  /** Explicit bounded port; address conflicts fail without stopping another process. */
  const value = args.port ?? args.p ?? 3000;
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^[0-9]+$/.test(String(value))
  ) {
    throw new TypeError('Invalid static server port');
  }
  /** Numeric conversion follows primitive integer syntax validation. */
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new TypeError('Invalid static server port');
  }
  if (args.dir !== undefined && typeof args.dir !== 'string') {
    throw new TypeError('Invalid static directory');
  }
  if (
    args.host !== undefined &&
    (typeof args.host !== 'string' ||
      !['127.0.0.1', '::1', '0.0.0.0'].includes(args.host))
  ) {
    throw new TypeError('Invalid static host');
  }
  /** Borrowed immutable static-output handler; no private config/module loading occurs. */
  const handler = await createStaticSiteHandler({
    rootDir: process.cwd(),
    outDir: (args.dir as string | undefined) ?? 'out',
  });
  let pending = 0;
  /** Native listener owns transport teardown; request failures are redacted. */
  const server = createServer((req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET, HEAD');
      res.setHeader('Connection', 'close');
      req.resume();
      res.end();
      return;
    }
    if (pending >= 8) {
      res.statusCode = 503;
      req.resume();
      res.end('Static server busy');
      return;
    }
    pending++;

    void Promise.resolve()
      .then(() =>
        handler(
          new Request(new URL(req.url ?? '/', 'http://static.invalid'), {
            method: req.method,
            headers: Object.fromEntries(
              Object.entries(req.headers).filter(
                (entry): entry is [string, string] =>
                  typeof entry[1] === 'string'
              )
            ),
          })
        )
      )
      .then((response) => sendFetchResponse(req, res, response))
      .catch(() => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.end('Static request failed');
        } else {
          res.destroy();
        }
      })
      .finally(() => {
        pending--;
      });
  });
  server.maxConnections = 128;
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, String(args.host ?? '127.0.0.1'), () => {
      server.off('error', reject);
      resolve();
    });
  });
  console.info(`[zerux static] http://${args.host ?? '127.0.0.1'}:${port}`);
  return server;
}
