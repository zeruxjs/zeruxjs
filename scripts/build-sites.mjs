import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { sites } from "../sites.config.mjs";
import { optimizeStaticAssets } from "./static-site-assets.mjs";
import zuix from "../pages/zuix.config.mjs";
import { discoverWorkspaces } from "./workspace-graph.mjs";

export const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
export const output = path.join(repositoryRoot, sites.output);

/** Escape catalog metadata for HTML. @param {unknown} value Input. @returns {string} Safe text. No globals. */
function escape(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ],
  );
}
/** Validate disjoint ownership and safe repository-relative source/output paths. @returns {void} Nothing. Reads sites configuration only. */
export function validateSites() {
  const mounts = new Set(),
    ids = new Set();
  for (const value of [sites.output, sites.published, sites.root.source]) {
    if (
      typeof value !== "string" ||
      !value ||
      value === "." ||
      path.isAbsolute(value) ||
      value.split(/[\\/]/).some((segment) => ["..", ".git"].includes(segment))
    )
      throw new Error(`Unsafe generated path: ${value}`);
  }
  for (const value of [sites.output, sites.published])
    for (const source of [
      sites.root.source,
      ...sites.apps.map((app) => app.directory),
    ])
      if (value === source || value.startsWith(source + "/"))
        throw new Error("Generated staging cannot overlap site sources");
  for (const value of sites.root.owned)
    if (!/^[a-zA-Z0-9._-]+$/.test(value) || [".", "..", ".git"].includes(value))
      throw new Error("Unsafe root ownership entry");
  if (sites.output === sites.published)
    throw new Error("Build and publish staging must be separate");
  for (const app of sites.apps) {
    if (!/^[a-z0-9-]+$/.test(app.id) || ids.has(app.id))
      throw new Error(`Invalid/duplicate site ID: ${app.id}`);
    if (!/^\/[a-z0-9-]+$/.test(app.mount) || mounts.has(app.mount))
      throw new Error(`Choose a unique /{site} mount: ${app.mount}`);
    ids.add(app.id);
    mounts.add(app.mount);
    for (const value of [app.directory, app.output])
      if (
        typeof value !== "string" ||
        path.isAbsolute(value) ||
        value.split(/[\\/]/).includes("..")
      )
        throw new Error(`Unsafe site path: ${value}`);
    if (
      !Array.isArray(app.build) ||
      !app.build.length ||
      app.build.some((value) => typeof value !== "string")
    )
      throw new Error(`Missing build command: ${app.id}`);
    if (sites.root.owned.includes(app.mount.slice(1)))
      throw new Error(`Site mount overlaps root-owned files: ${app.mount}`);
  }
}
/** Copy static files without allowing links, secret files or non-files into the public tree.
 * @param {string} source Input. @param {string} destination Output. @returns {Promise<void>} Completion. Reads explicitly configured static build output.
 */
export async function copyStatic(source, destination) {
  const stat = await fs.lstat(source);
  if (stat.isSymbolicLink())
    throw new Error(`Symlink in static files: ${source}`);
  if (stat.isDirectory()) {
    await fs.mkdir(destination, { recursive: true });
    for (const name of await fs.readdir(source)) {
      if (name === ".git") continue;
      if (/^\.env(?:\.|$)/.test(name) || /\.(?:pem|key)$/i.test(name))
        throw new Error(`Secret-like file in static output: ${name}`);
      await copyStatic(path.join(source, name), path.join(destination, name));
    }
  } else if (stat.isFile()) {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  } else throw new Error(`Unsupported static file: ${source}`);
}
/** Validate all local routes/assets/anchors across the shared tree.
 * @param {string} directory Combined site root. @returns {Promise<object>} Counts. Reads static output only.
 */
export async function verifySites(directory) {
  const files = new Map();
  async function walk(base) {
    for (const entry of await fs.readdir(base, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      if (
        /^\.env(?:\.|$)/.test(entry.name) ||
        /\.(?:pem|key)$/i.test(entry.name)
      )
        throw new Error(`Secret-like file in static tree: ${entry.name}`);
      const file = path.join(base, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Symlink in published tree: ${file}`);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile())
        files.set(
          "/" + path.relative(directory, file).split(path.sep).join("/"),
          await fs.readFile(file, "utf8"),
        );
    }
  }
  await walk(directory);
  if (!files.has("/index.html")) throw new Error("Shared homepage is missing");
  for (const app of sites.apps)
    if (!files.has(app.mount + "/index.html"))
      throw new Error(`Missing site index: ${app.mount}`);
  const ids = new Map(
    [...files]
      .filter(([name]) => name.endsWith(".html"))
      .map(([name, content]) => [
        name,
        new Set(
          [...content.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]),
        ),
      ]),
  );
  let links = 0;
  for (const [name, content] of files)
    if (name.endsWith(".html"))
      for (const match of content.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
        const href = match[1].replaceAll("&amp;", "&");
        if (!href.startsWith("/") && !href.startsWith("#")) continue;
        const url = new URL(href, "https://site.invalid" + name);
        const target =
          decodeURIComponent(url.pathname) +
          (url.pathname.endsWith("/") ? "index.html" : "");
        if (!files.has(target))
          throw new Error(`Broken site link ${href} in ${name}`);
        if (
          url.hash &&
          ids.has(target) &&
          !ids.get(target).has(decodeURIComponent(url.hash.slice(1)))
        )
          throw new Error(`Broken site anchor ${href} in ${name}`);
        links++;
      }
  return { html: ids.size, links };
}
/** Build each app with live child output. @param {object} app Site configuration. @returns {Promise<void>} Completion. Runs only declared build commands, without a shell. */
async function buildApp(app, production) {
  console.info(`[sites] START ${app.id} → ${app.mount}/`);
  const [command, ...args] =
    !production && app.developmentBuild ? app.developmentBuild : app.build;
  await new Promise((resolve, reject) => {
    const child = spawn(command === "node" ? process.execPath : command, args, {
      cwd: path.join(repositoryRoot, app.directory),
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`${app.id} build failed (${signal || code})`)),
    );
  });
  console.info(`[sites] READY ${app.id}`);
}
/** Build the shared home and every configured app, then verify before promotion.
 * @returns {Promise<object>} Static deployment manifest. Reads workspace manifests; writes only fixed generated directories.
 */
export async function buildSites({ production = true } = {}) {
  validateSites();
  const results = await Promise.allSettled(
    sites.apps.map((app) => buildApp(app, production)),
  );
  for (const result of results)
    if (result.status === "rejected") throw result.reason;
  const staging = await fs.mkdtemp(path.join(repositoryRoot, ".site-stage-"));
  try {
    for (const app of sites.apps)
      await copyStatic(
        path.join(repositoryRoot, app.directory, app.output),
        path.join(staging, app.mount.slice(1)),
      );
    const rootSource = path.join(repositoryRoot, sites.root.source);
    await fs.mkdir(path.join(staging, "site-assets"));
    await copyStatic(
      path.join(rootSource, "app.js"),
      path.join(staging, "site-assets/app.js"),
    );
    const packages = [...discoverWorkspaces(repositoryRoot).values()]
      .filter(
        (item) =>
          item.pkg.private !== true &&
          !path.basename(item.dir).startsWith("sample"),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    const docsApp = sites.apps.find((app) => app.id === "zeruxjs");
    const docs = docsApp
      ? JSON.parse(
          await fs.readFile(
            path.join(staging, docsApp.mount.slice(1), "build-manifest.json"),
            "utf8",
          ),
        )
      : null;
    const cards = packages
      .map(
        ({ name, pkg }) =>
          `<article class="package"><h3>${escape(name)}</h3><small>v${escape(pkg.version)}</small><p>${escape(pkg.description || "A package in the ZeruxJS ecosystem.")}</p><div class="package-links">${docs?.packageRoutes?.[name] ? `<a href="${escape(docs.packageRoutes[name])}">Read guide →</a>` : ""}<a href="https://www.npmjs.com/package/${escape(name)}">npm ↗</a></div></article>`,
      )
      .join("");
    const html = (
      await fs.readFile(path.join(rootSource, "index.html"), "utf8")
    )
      .replace("{{PACKAGE_COUNT}}", String(packages.length))
      .replace("{{PACKAGE_CARDS}}", cards)
      .replace(
        "{{FRAMEWORK_TUTORIAL_URL}}",
        docs ? `${docsApp.mount}/docs/${docs.latest}/tutorial/` : "/zeruxjs/",
      );
    await fs.writeFile(path.join(staging, "index.html"), html);
    await fs.writeFile(
      path.join(staging, "404.html"),
      '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page not found · ZeruxJS</title><link rel="stylesheet" href="/site-assets/style.css"></head><body><main><section class="hero"><h1>Page not found.</h1><p>The requested page is not available.</p><a href="/">Open the ecosystem home →</a><br><a href="/zeruxjs/">Browse ZeruxJS documentation →</a></section></main></body></html>',
    );
    const sitemapLines = new Set();
    for (const app of sites.apps) {
      const robots = await fs
        .readFile(path.join(staging, app.mount.slice(1), "robots.txt"), "utf8")
        .catch((error) => {
          if (error.code !== "ENOENT") throw error;
          return "";
        });
      for (const match of robots.matchAll(/^Sitemap: (https?:\/\/[^\s]+)$/gm))
        sitemapLines.add(`Sitemap: ${match[1]}\n`);
    }
    await fs.writeFile(
      path.join(staging, "robots.txt"),
      "User-agent: *\nAllow: /\n" + [...sitemapLines].join(""),
    );
    await fs.writeFile(path.join(staging, ".nojekyll"), "");
    const manifest = {
      schema: 1,
      outputBranch: sites.outputBranch,
      rootOwned: sites.root.owned,
      sites: sites.apps.map((app) => ({ id: app.id, mount: app.mount })),
      packages: packages.length,
    };
    await fs.writeFile(
      path.join(staging, "site-manifest.json"),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    await optimizeStaticAssets({
      directory: staging,
      htmlFiles: ["index.html", "404.html"].map((file) =>
        path.join(staging, file),
      ),
      css: "site-assets/style.css",
      entries: ["app.js"],
      sourceRoot: rootSource,
      basePath: "",
      zuix,
      production,
    });
    const checks = await verifySites(staging);
    const existing = await fs.lstat(output).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (existing?.isSymbolicLink())
      throw new Error("Refusing linked combined output");
    const previous = path.join(repositoryRoot, ".site-previous");
    if (await fs.lstat(previous).catch(() => null))
      throw new Error(
        "Previous combined build exists; inspect it before rebuilding",
      );
    if (existing) await fs.rename(output, previous);
    try {
      await fs.rename(staging, output);
    } catch (error) {
      if (existing) await fs.rename(previous, output);
      throw error;
    }
    if (existing) await fs.rm(previous, { recursive: true, force: true });
    console.info(
      `[sites] COMPLETE: shared home + ${sites.apps.length} site(s), ${checks.html} HTML files, ${checks.links} verified links → ${sites.output}/`,
    );
    return manifest;
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await buildSites();
