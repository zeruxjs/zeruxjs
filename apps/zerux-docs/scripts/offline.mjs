import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { buildTypescript } from "@zeruxjs/typescript";

/** Emit a docs-scoped, opt-in PWA worker after production asset hashing. @param {string} directory Owned output root. @param {object} site Public mount configuration. @param {object[]} pages Validated route metadata. @param {object} assets Asset report. @returns {Promise<void>} Writes only static app artifacts. No environment/credential reads. */
export async function emitOffline(
  directory,
  site,
  pages,
  assets,
  { production = true } = {},
) {
  const relative = (url) => url.slice(site.basePath.length + 1);
  const searchHash = createHash("sha256")
    .update(await fs.readFile(path.join(directory, "assets/search.json")))
    .digest("hex")
    .slice(0, 12);
  const resourceUrls = assets.assets.map(
    (item) => `${relative(item.url)}?v=${item.version}`,
  );
  resourceUrls.push(`assets/search.json?v=${searchHash}`);
  const version = createHash("sha256")
    .update(
      JSON.stringify({ pages: pages.map((p) => [p.url, p.body]), assets }),
    )
    .digest("hex")
    .slice(0, 16);
  const routes = [
    "",
    ...pages.map((page) => relative(page.url)),
    "offline.html",
  ];
  const worker = `/* Generated docs-only offline reader. Installed only after explicit visitor consent. */
const ROOT = new URL('./', self.location.href);
const PREFIX = 'zerux-docs:' + ROOT.pathname + ':';
const VERSION = ${JSON.stringify(version)};
const PAGE_CACHE = PREFIX + VERSION + ':pages';
const ASSET_CACHE = PREFIX + VERSION + ':assets';
const PAGES = new Set(${JSON.stringify(routes)}.map(path => new URL(path, ROOT).href));
const ASSETS = new Set(${JSON.stringify(resourceUrls)}.map(path => new URL(path, ROOT).href));
const FALLBACK = new URL('offline.html', ROOT).href;
const SEED = [ROOT.href, FALLBACK, ...ASSETS];
const MAX_PAGE_BYTES = 1024 * 1024;
async function store(name, request, response, limit) {
  if (!response.ok || response.type === 'opaque' || /no-store/i.test(response.headers.get('cache-control') || '')) return;
  const bytes = await response.clone().arrayBuffer();
  if (bytes.byteLength > MAX_PAGE_BYTES) return;
  const cache = await caches.open(name);
  const headers = new Headers(response.headers);
  headers.delete('content-encoding');
  headers.set('content-length', String(bytes.byteLength));
  await cache.put(request, new Response(bytes, {status:response.status,statusText:response.statusText,headers}));
  const keys = await cache.keys();
  let excess = keys.length - limit;
  for (const old of keys) {
    if (excess <= 0) break;
    if (old.url !== ROOT.href && old.url !== FALLBACK) { await cache.delete(old); excess--; }
  }
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    for (const url of SEED) {
      const response = await fetch(url, {cache:'reload',credentials:'omit'});
      if (!response.ok) throw new Error('Offline seed unavailable');
      await store(ASSETS.has(url) ? ASSET_CACHE : PAGE_CACHE, url, response, ASSETS.has(url) ? 24 : 60);
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith(PREFIX) && key !== PAGE_CACHE && key !== ASSET_CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => { if (event.data?.type === 'ACTIVATE_DOCS_UPDATE') self.skipWaiting(); });
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== ROOT.origin || !url.pathname.startsWith(ROOT.pathname)) return;
  const asset = ASSETS.has(url.href);
  const page = !url.search && PAGES.has(url.href);
  if (!asset && !page) return;
  event.respondWith((async () => {
    const cache = await caches.open(asset ? ASSET_CACHE : PAGE_CACHE);
    const cached = await cache.match(request);
    if (asset && cached) return cached;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(request, {signal:controller.signal});
      event.waitUntil(store(asset ? ASSET_CACHE : PAGE_CACHE, request, response.clone(), asset ? 24 : 60).catch(() => {}));
      return response;
    } catch {
      if (cached) return cached;
      if (request.mode === 'navigate') return await (await caches.open(PAGE_CACHE)).match(FALLBACK) || new Response('Offline. Reconnect to read this page.', {status:503,headers:{'content-type':'text/plain'}});
      return new Response('Offline resource unavailable', {status:503});
    } finally { clearTimeout(timer); }
  })());
});
`;
  const workerFile = path.join(directory, "sw.js");
  await fs.writeFile(workerFile, worker);
  if (production) {
    const temporary = await fs.mkdtemp(path.join(directory, ".worker-build-"));
    try {
      await buildTypescript({
        entryPoints: [workerFile],
        outdir: temporary,
        platform: "browser",
        format: "iife",
        target: "es2022",
        bundle: true,
        minify: true,
        sourcemap: false,
      });
      await fs.copyFile(path.join(temporary, "sw.js"), workerFile);
    } finally {
      await fs.rm(temporary, { recursive: true, force: true });
    }
  }
  await fs.writeFile(
    path.join(directory, "manifest.webmanifest"),
    JSON.stringify({
      id: "./",
      name: "ZeruxJS Field Guide",
      short_name: "ZeruxJS Docs",
      description:
        "Learn, build and solve with source-backed ZeruxJS documentation.",
      start_url: "./",
      scope: "./",
      display: "standalone",
      lang: "en",
      background_color: "#f8f9fd",
      theme_color: "#263b74",
      icons: [
        {
          src: "icons/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "icons/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
      ],
    }),
  );
}
