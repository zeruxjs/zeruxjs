import { themeBootstrap } from "./site-theme.mjs";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createZuix, extractClasses } from "zuixs";
import { buildTypescript } from "@zeruxjs/typescript";

/** Digest static bytes for cache-busting URLs. @param {string|Buffer} bytes Content. @returns {string} Short digest. No globals. */
export function assetVersion(bytes) {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}

/** Compile on-demand Zuixs CSS and browser JS/CSS with the workspace TypeScript/esbuild API.
 * @param {{directory:string,htmlFiles:string[],css:string,entries:string[],sourceRoot:string,basePath:string,zuix:object,production?:boolean,search?:{file:string,module:string}}} options Static assets and owned HTML files.
 * @returns {Promise<object>} Sizes and generated utility count. Reads trusted templates/config only; writes provided app-local staging paths.
 */
export async function optimizeStaticAssets({
  directory,
  htmlFiles,
  css,
  entries,
  sourceRoot,
  basePath,
  zuix,
  production = true,
  search,
}) {
  const documents = await Promise.all(
    htmlFiles.map(async (file) => [file, await fs.readFile(file, "utf8")]),
  );
  const classes = new Set(
    documents
      .flatMap(([, html]) => extractClasses(html))
      .filter((token) => /(^|:)ui-/.test(token)),
  );
  const generated = createZuix({
    ...zuix,
    minify: production,
  }).generate(classes);
  if (generated.unmatched.length)
    throw new Error(
      `Unsupported site utility classes: ${generated.unmatched.join(", ")}`,
    );
  await fs.writeFile(path.join(directory, css), generated.css);
  const temporary = await fs.mkdtemp(path.join(directory, ".asset-build-"));
  const records = [];
  try {
    const inputs = [
      path.join(directory, css),
      ...entries.map((entry) => path.resolve(sourceRoot, entry)),
    ];
    const results = await Promise.allSettled(
      inputs.map((entry) =>
        buildTypescript({
          entryPoints: [entry],
          outdir: temporary,
          cwd: sourceRoot,
          platform: "browser",
          format: "esm",
          target: "es2022",
          bundle: true,
          minify: production,
          sourcemap: !production,
        }),
      ),
    );
    for (const result of results)
      if (result.status === "rejected") throw result.reason;
    for (const entry of inputs) {
      const name = path.basename(entry),
        target = path.join(directory, path.dirname(css), name);
      const bytes = await fs.readFile(path.join(temporary, name));
      await fs.writeFile(target, bytes);
      if (!production)
        await fs.copyFile(path.join(temporary, name + ".map"), target + ".map");
      const url =
        (basePath || "") +
        "/" +
        path.posix.join(path.dirname(css).split(path.sep).join("/"), name);
      records.push({
        url,
        version: assetVersion(bytes),
        bytes: bytes.length,
        sourceBytes: Buffer.byteLength(
          entry === inputs[0] ? generated.css : await fs.readFile(entry),
        ),
      });
    }
    let searchAttributes = "";
    if (search) {
      const index = await fs.readFile(path.join(directory, search.file));
      const module = records.find((record) =>
        record.url.endsWith("/" + search.module),
      );
      if (!module) throw new Error("Compiled search module missing");
      searchAttributes = ` data-search-version="${assetVersion(index)}" data-search-module="${module.url}?v=${module.version}"`;
    }
    for (const [file, html] of documents) {
      let final = html
        .replace("<head>", `<head><script>${themeBootstrap}</script>`)
        .replace(/\b(href|src)="([^"?#]+)"/g, (match, attribute, url) => {
          const record = records.find((record) => record.url === url);
          return record ? `${attribute}="${url}?v=${record.version}"` : match;
        })
        .replace(/<body\b/, `<body${searchAttributes}`);
      await fs.writeFile(file, final);
    }
    const report = {
      production,
      compiler: "zuixs",
      bundler: "@zeruxjs/typescript",
      utilities: classes.size,
      recipes: zuix.recipes?.length ?? 0,
      assets: records,
    };
    await fs.writeFile(
      path.join(directory, path.dirname(css), "asset-manifest.json"),
      JSON.stringify(report, null, 2),
    );
    console.info(
      `[assets] ${basePath || "/"}: ${classes.size} scanned Zuixs utilities + ${zuix.recipes?.length ?? 0} utility recipes; ${production ? "minified production" : "readable development"} CSS/JS (${records.reduce((total, item) => total + item.bytes, 0)} bytes)`,
    );
    return report;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

/** List static HTML recursively. @param {string} directory Static root. @returns {Promise<string[]>} HTML files. No environment access. */
export async function htmlFiles(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory())
      files.push(...(await htmlFiles(path.join(directory, entry.name))));
    else if (entry.isFile() && entry.name.endsWith(".html"))
      files.push(path.join(directory, entry.name));
  }
  return files;
}
