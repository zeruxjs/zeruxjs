import http from "node:http";
import fs from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { buildSites, repositoryRoot, output } from "./build-sites.mjs";
import { sites } from "../sites.config.mjs";

const development = process.argv.includes("--dev");
const clients = new Set();
if (development) {
  await buildSites({ production: false });
  let timer,
    building = false,
    pending = false;
  /** Rebuild after edits while preserving a working export on validation failure. @returns {Promise<void>} Completion. Owns local watchers/SSE clients only. */
  async function rebuild() {
    if (building) {
      pending = true;
      return;
    }
    building = true;
    do {
      pending = false;
      try {
        await buildSites({ production: false });
        for (const client of clients)
          client.write("event: reload\ndata: complete\n\n");
      } catch (error) {
        console.error("[sites] Rebuild failed:", error.message);
      }
    } while (pending);
    building = false;
  }
  const directories = [
    sites.root.source,
    ...sites.apps.flatMap((app) =>
      (app.watch ?? ["src", "public", "scripts", "app", "components"]).map(
        (child) => path.join(app.directory, child),
      ),
    ),
  ];
  for (const directory of directories) {
    const full = path.join(repositoryRoot, directory);
    if (!(await fs.stat(full).catch(() => null))) continue;
    watch(full, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void rebuild();
      }, 150);
    });
  }
}
const port = Number(process.env.PORT || 3010),
  host = process.env.HOST || "127.0.0.1";
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error("Invalid PORT");
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};
/** Serve only the combined public export and optional dev reload endpoints.
 * @param {import('node:http').IncomingMessage} req Request. @param {import('node:http').ServerResponse} res Response.
 * @returns {Promise<void>} Completion. Reads generated output; HOST/PORT select the local listener.
 */
async function handle(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!["GET", "HEAD"].includes(req.method)) {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    ).replace(/^\/+/, "/");
  } catch {
    res.writeHead(400);
    res.end();
    return;
  }
  if (development && pathname === "/__site-dev/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    res.write(": connected\n\n");
    clients.add(res);
    res.once("close", () => clients.delete(res));
    return;
  }
  if (development && pathname === "/__site-dev/client.js") {
    res.writeHead(200, {
      "Content-Type": types[".js"],
      "Cache-Control": "no-store",
    });
    res.end(
      req.method === "HEAD"
        ? undefined
        : "const updates = new EventSource('/__site-dev/events'); updates.addEventListener('reload', () => location.reload());",
    );
    return;
  }
  let filename = path.resolve(output, "." + pathname);
  if (!filename.startsWith(output + path.sep) && filename !== output) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const info = await fs.stat(filename);
    if (info.isDirectory()) {
      if (!pathname.endsWith("/")) {
        res.writeHead(308, { Location: pathname + "/" });
        res.end();
        return;
      }
      filename = path.join(filename, "index.html");
    }
    let data = await fs.readFile(filename);
    if (development && path.extname(filename) === ".html")
      data = Buffer.from(
        data
          .toString()
          .replace(
            "</body>",
            '<script src="/__site-dev/client.js" defer></script></body>',
          ),
      );
    res.writeHead(200, {
      "Content-Type":
        types[path.extname(filename)] || "application/octet-stream",
      "Content-Length": data.length,
      ...(development ? { "Cache-Control": "no-store" } : {}),
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch (error) {
    const missing = ["ENOENT", "ENOTDIR"].includes(error.code);
    res.writeHead(missing ? 404 : 500, { "Content-Type": types[".html"] });
    res.end(
      req.method === "HEAD"
        ? undefined
        : missing
          ? await fs
              .readFile(path.join(output, "404.html"))
              .catch(() => "Build the sites first.")
          : "Preview failed",
    );
  }
}
http
  .createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  })
  .listen(port, host, function () {
    console.info(
      `[sites] ${development ? "Development" : "Preview"}: http://${host}:${this.address().port}/ (docs: /zeruxjs/)`,
    );
  });
