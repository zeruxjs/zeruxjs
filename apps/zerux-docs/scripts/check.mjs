import { markdownDigest } from "../src/lib/raw-markdown.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sitePath } from "../src/site.config.mjs";
import { root } from "../src/lib/content.mjs";

/** Validate emitted routes, anchors, asset links and search coverage.
 * @param {string} directory Generated export. @returns {Promise<object>} Validation counts. Reads generated output only.
 */
export async function check(directory = path.join(root, "dist")) {
  const files = new Map();
  async function walk(base) {
    for (const entry of await fs.readdir(base, { withFileTypes: true })) {
      const file = path.join(base, entry.name);
      if (entry.isSymbolicLink())
        throw new Error(`Symlink in static export: ${file}`);
      if (entry.isDirectory()) await walk(file);
      else if (entry.isFile())
        files.set(
          "/" + path.relative(directory, file).split(path.sep).join("/"),
          await fs.readFile(file, "utf8"),
        );
    }
  }
  await walk(directory);
  const html = [...files].filter(([name]) => name.endsWith(".html"));
  const ids = new Map();
  for (const [name, content] of html) {
    if (
      !content.startsWith("<!doctype html>") ||
      !content.includes("<h1>") ||
      !content.includes("<article")
    )
      throw new Error(`Incomplete static HTML: ${name}`);
    const found = [...content.matchAll(/\bid="([^"]+)"/g)].map(
      (match) => match[1],
    );
    if (new Set(found).size !== found.length)
      throw new Error(`Duplicate heading/element IDs: ${name}`);
    ids.set(name, new Set(found));
  }
  const resolve = (pathname) =>
    pathname.endsWith("/") ? pathname + "index.html" : pathname;
  let links = 0;
  for (const [name, content] of html) {
    for (const match of content.matchAll(
      /(data-site-root )?\b(?:href|src)="([^"]+)"/g,
    )) {
      const href = match[2].replaceAll("&amp;", "&");
      if (match[1] && href === "/") continue; // The ecosystem root is owned by the combined builder.
      if (!href.startsWith("/") && !href.startsWith("#")) continue;
      const url = new URL(href, "https://docs.invalid" + name);
      const target = resolve(decodeURIComponent(url.pathname));
      if (!files.has(target)) throw new Error(`Broken link ${href} in ${name}`);
      if (
        url.hash &&
        ids.has(target) &&
        !ids.get(target).has(decodeURIComponent(url.hash.slice(1)))
      )
        throw new Error(`Broken anchor ${href} in ${name}`);
      links++;
    }
  }
  const manifest = JSON.parse(files.get(sitePath("/build-manifest.json")));
  if (!files.has(sitePath("/.nojekyll")))
    throw new Error("Raw Markdown requires .nojekyll");
  for (const [url, digest] of Object.entries(manifest.markdownFiles ?? {})) {
    const text = files.get(url);
    if (
      !text ||
      /^\s*<!doctype html/i.test(text) ||
      markdownDigest(text) !== digest
    )
      throw new Error(`Missing or altered Markdown export: ${url}`);
  }
  for (const page of manifest.pages) {
    if (
      !manifest.markdownFiles?.[page.slice(0, -1) + ".md"] ||
      !manifest.markdownFiles?.[page + "index.md"]
    )
      throw new Error(`Missing Markdown alternatives: ${page}`);
  }
  const search = JSON.parse(files.get(sitePath("/assets/search.json")));
  if (
    search.schema !== 2 ||
    !Array.isArray(search.pages) ||
    !Array.isArray(search.sections)
  )
    throw new Error("Invalid compact search schema");
  const entries = [
    ...search.pages.map((row) => ({ url: row[3] })),
    ...search.sections.map((row) => ({
      url: search.pages[row[0]][3] + "#" + row[2],
    })),
  ];
  for (const page of manifest.pages) {
    if (!files.has(resolve(page))) throw new Error(`Missing page ${page}`);
    if (!entries.some((entry) => entry.url.split("#")[0] === page))
      throw new Error(`Page absent from search: ${page}`);
  }
  for (const entry of entries) {
    const url = new URL(entry.url, "https://docs.invalid");
    const target = resolve(url.pathname);
    if (
      !files.has(target) ||
      (url.hash && !ids.get(target)?.has(url.hash.slice(1)))
    )
      throw new Error(`Broken search result ${entry.url}`);
  }
  return { pages: html.length, links, searchEntries: entries.length };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  console.info("[docs] Verified", await check());
