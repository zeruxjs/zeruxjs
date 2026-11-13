import { minifySiteHtml } from './minify-site-html.mjs';
import { themeBootstrap } from './site-theme.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createZuix, extractClasses } from 'zuixs';
import { buildTypescript } from '@zeruxjs/typescript';

/** Digest static bytes for cache-busting URLs. @param {string|Buffer} bytes Content. @returns {string} Short digest. No globals. */
/** Perform the asset version operation.
 * @param {unknown} bytes - Input value for bytes.
 * @returns {unknown} Result produced by asset version.
 */
export function assetVersion(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 12);
}

/** Compile on-demand Zuixs CSS and browser JS/CSS with the workspace TypeScript/esbuild API.
 * @param {{directory:string,htmlFiles:string[],css:string,entries:string[],sourceRoot:string,basePath:string,zuix:object,production?:boolean,inlineCss?:boolean,search?:{file:string,module:string}}} options Static assets and owned HTML files. inlineCss opts small, self-contained production stylesheets into HTML delivery.
 * @returns {Promise<object>} Sizes and generated utility count. Reads trusted templates/config only; writes provided app-local staging paths.
 */
/** Perform the optimize static assets operation.
 * @param {unknown} root0 - Input value for root0.
 * @param {unknown} root0.directory - Input value for directory.
 * @param {unknown} root0.htmlFiles - Input value for html files.
 * @param {unknown} root0.css - Input value for css.
 * @param {unknown} root0.entries - Input value for entries.
 * @param {unknown} root0.sourceRoot - Input value for source root.
 * @param {unknown} root0.basePath - Input value for base path.
 * @param {unknown} root0.zuix - Input value for zuix.
 * @param {unknown} root0.production - Input value for production.
 * @param {unknown} root0.inlineCss - Input value for inline css.
 * @param {unknown} root0.search - Input value for search.
 * @returns {unknown} Result produced by optimize static assets.
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
  inlineCss = false,
  search,
}) {
  /** Local value for documents. */
  const documents = await Promise.all(
    htmlFiles.map(async (file) => [file, await fs.readFile(file, 'utf8')])
  );
  /** Local value for classes. */
  const classes = new Set(
    documents
      .flatMap(([, html]) => extractClasses(html))
      .filter((token) => /(^|:)ui-/.test(token))
  );
  /** Local value for generated. */
  const generated = createZuix({
    ...zuix,
    minify: production,
  }).generate(classes);
  if (generated.unmatched.length) {
    throw new Error(
      `Unsupported site utility classes: ${generated.unmatched.join(', ')}`
    );
  }
  await fs.writeFile(path.join(directory, css), generated.css);
  /** Local value for temporary. */
  const temporary = await fs.mkdtemp(path.join(directory, '.asset-build-'));
  /** Local value for records. */
  const records = [];
  try {
    /** Local value for inputs. */
    const inputs = [
      path.join(directory, css),
      ...entries.map((entry) => path.resolve(sourceRoot, entry)),
    ];
    /** Local value for results. */
    const results = await Promise.allSettled(
      inputs.map((entry) =>
        buildTypescript({
          entryPoints: [entry],
          outdir: temporary,
          cwd: sourceRoot,
          platform: 'browser',
          format: 'esm',
          target: 'es2022',
          bundle: true,
          minify: production,
          sourcemap: !production,
        })
      )
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        throw result.reason;
      }
    }
    for (const entry of inputs) {
      /** Local value for name. */
      const name = path.basename(entry),
        target = path.join(directory, path.dirname(css), name);
      /** Local value for bytes. */
      const bytes = await fs.readFile(path.join(temporary, name));
      await fs.writeFile(target, bytes);
      if (!production) {
        await fs.copyFile(path.join(temporary, name + '.map'), target + '.map');
      }
      /** Local value for url. */
      const url =
        (basePath || '') +
        '/' +
        path.posix.join(path.dirname(css).split(path.sep).join('/'), name);
      records.push({
        url,
        version: assetVersion(bytes),
        bytes: bytes.length,
        sourceBytes: Buffer.byteLength(
          entry === inputs[0] ? generated.css : await fs.readFile(entry)
        ),
      });
    }
    let searchAttributes = '';
    if (search) {
      /** Local value for index. */
      const index = await fs.readFile(path.join(directory, search.file));
      /** Local value for module. */
      const module = records.find((record) =>
        record.url.endsWith('/' + search.module)
      );
      if (!module) {
        throw new Error('Compiled search module missing');
      }
      searchAttributes = ` data-search-version="${assetVersion(index)}" data-search-module="${module.url}?v=${module.version}"`;
    }
    /** Local value for stylesheet. */
    const stylesheet = records.find((record) => record.url.endsWith('/' + css));
    /** Local value for css text. */
    const cssText = await fs.readFile(path.join(directory, css), 'utf8');
    // Inline only a small, self-contained stylesheet. External delivery preserves
    // relative URL semantics and shared caching for larger/documentation bundles.
    /** Local value for can inline css. */
    const canInlineCss =
      production &&
      inlineCss &&
      stylesheet &&
      Buffer.byteLength(cssText) <= 16 * 1024 &&
      !/(?:@import\b|url\s*\()/i.test(cssText);
    if (canInlineCss && /<\/style/i.test(cssText)) {
      throw new Error(
        'Cannot embed a stylesheet containing an HTML style terminator'
      );
    }
    let inlinedStylesheets = 0;
    for (const [file, html] of documents) {
      let final = html
        .replace('<head>', `<head><script>${themeBootstrap}</script>`)
        .replace(/\b(href|src)="([^"?#]+)"/g, (match, attribute, url) => {
          /** Local value for record. */
          const record = records.find((record) => record.url === url);
          return record ? `${attribute}="${url}?v=${record.version}"` : match;
        })
        .replace(/<body\b/, `<body${searchAttributes}`);
      if (canInlineCss) {
        final = final.replace(/<link\b[^>]*>/gi, (link) => {
          /** Local value for href. */
          const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(link)?.[1];
          if (
            !/\brel\s*=\s*["']stylesheet["']/i.test(link) ||
            /\b(?:media|disabled|title)\b/i.test(link) ||
            href !== `${stylesheet.url}?v=${stylesheet.version}`
          ) {
            return link;
          }
          inlinedStylesheets++;
          return `<style data-site-css="${stylesheet.version}">${cssText}</style>`;
        });
      }
      if (production) {
        final = minifySiteHtml(final);
      }
      await fs.writeFile(file, final);
    }
    /** Local value for report. */
    const report = {
      production,
      inlinedStylesheets,
      compiler: 'zuixs',
      bundler: '@zeruxjs/typescript',
      utilities: classes.size,
      recipes: zuix.recipes?.length ?? 0,
      assets: records,
    };
    await fs.writeFile(
      path.join(directory, path.dirname(css), 'asset-manifest.json'),
      JSON.stringify(report, null, 2)
    );
    console.info(
      `[assets] ${basePath || '/'}: ${classes.size} scanned Zuixs utilities + ${zuix.recipes?.length ?? 0} utility recipes; ${production ? 'minified production' : 'readable development'} CSS/JS (${records.reduce((total, item) => total + item.bytes, 0)} bytes)`
    );
    return report;
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
}

/** List static HTML recursively. @param {string} directory Static root. @returns {Promise<string[]>} HTML files. No environment access. */
/** Perform the html files operation.
 * @param {unknown} directory - Input value for directory.
 * @returns {unknown} Result produced by html files.
 */
export async function htmlFiles(directory) {
  /** Local value for files. */
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      files.push(...(await htmlFiles(path.join(directory, entry.name))));
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(path.join(directory, entry.name));
    }
  }
  return files;
}
