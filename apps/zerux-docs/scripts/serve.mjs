import http from "node:http";
import { site, sitePath } from "../src/site.config.mjs";
import { watch } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { build, output, root } from "./build.mjs";

const development = process.argv.includes("--dev");
if (development) {
  await build({ production: false });
  let scheduled;
  let active = false;
  let pending = false;
  /** Rebuild once per edit burst; a failed candidate leaves the prior export available.
   * @returns {Promise<void>} Completion. Reads watched docs/assets; owns local build scheduling only.
   */
  async function rebuild() {
    if (active) {
      pending = true;
      return;
    }
    active = true;
    do {
      pending = false;
      try {
        await build({ production: false });
      } catch (error) {
        console.error("[docs] Rebuild failed:", error.message);
      }
    } while (pending);
    active = false;
  }
  for (const directory of ["src/docs", "public"]) {
    watch(path.join(root, directory), { recursive: true }, () => {
      clearTimeout(scheduled);
      scheduled = setTimeout(() => {
        void rebuild();
      }, 100);
    });
  }
}
const port = Number(process.env.PORT || 3011);
const host = process.env.HOST || "127.0.0.1";
if (!Number.isInteger(port) || port < 0 || port > 65535)
  throw new Error("Invalid PORT");
const types = {
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/** Preview the app-local export. @param {import('node:http').IncomingMessage} request Incoming request. @param {import('node:http').ServerResponse} response Outgoing response. @returns {Promise<void>} Completion. Reads dist; HOST and PORT select the listener only. */
async function handle(request, response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    ).replace(/^\/+/, "/");
  } catch {
    response.writeHead(400);
    response.end("Invalid URL");
    return;
  }
  if (pathname === "/") {
    response.writeHead(308, { Location: sitePath("/") });
    response.end();
    return;
  }
  let filename = path.resolve(output, "." + pathname);
  if (!filename.startsWith(output + path.sep) && filename !== output) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    const stat = await fs.stat(filename);
    if (stat.isDirectory()) {
      if (!pathname.endsWith("/")) {
        response.writeHead(308, { Location: pathname + "/" });
        response.end();
        return;
      }
      filename = path.join(filename, "index.html");
    }
    const data = await fs.readFile(filename);
    response.writeHead(200, {
      "Content-Type":
        types[path.extname(filename)] || "application/octet-stream",
      "Content-Length": data.length,
    });
    response.end(request.method === "HEAD" ? undefined : data);
  } catch (error) {
    const missing = error.code === "ENOENT" || error.code === "ENOTDIR";
    response.writeHead(missing ? 404 : 500, {
      "Content-Type": "text/html; charset=utf-8",
    });
    const page = missing
      ? await fs
          .readFile(path.join(output, site.basePath.slice(1), "404.html"))
          .catch(() => "Run npm run build first.")
      : "Preview failed";
    response.end(request.method === "HEAD" ? undefined : page);
  }
}
http
  .createServer((request, response) => {
    handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
  })
  .listen(port, host, function () {
    console.info(
      `[docs] ${development ? "Development" : "Static preview"}: http://${host}:${this.address().port}${sitePath("/")}`,
    );
  });
