# Shared ecosystem homepage

This is the source for the domain homepage at `/`. It introduces ZeruxJS, ZyroJS, ZenixJS and the shared public package catalog. Dedicated site builds are mounted below independent paths such as `/zeruxjs/`.

`index.html` is a static template. `scripts/build-sites.mjs` inserts the public package catalog and places styles/browser code under `/site-assets/`. Do not deploy this source directory directly.

Develop the homepage and all configured sites from this directory:

```sh
npm run dev
```

Open `http://127.0.0.1:3010/` for the shared homepage and `/zeruxjs/` for docs. Source edits rebuild and reload the browser automatically. `HOST` and `PORT` override the listener.

Build and preview all sites from this directory:

```sh
npm run build
npm run preview
```

The combined static output is `../.site-build/`. Site mounts and root-owned files are declared in `../sites.config.mjs`. GitHub Actions commits owned output to `master-site` while preserving other paths, then deploys the branch's complete static tree to GitHub Pages. See `../SITE_DEPLOYMENT.md` for hosting and extension instructions.

## Production assets and navigation

`prebuild` and `predev` compile the four required workspace tools in parallel. Production builds use **Zuixs** to generate only the responsive `ui-` utilities present in rendered HTML, retaining authored component styles. `zuix.config.mjs` owns the utility prefix and breakpoints. **@zeruxjs/typescript** bundles browser modules and minifies CSS/JavaScript; development builds retain readable output and source maps. The asset manifest records sizes and content hashes used in cache-busting URLs. Production output has no source maps.

**@zeruxjs/performance/navigation** prefetches public documentation pages after hover or keyboard focus. Supporting browsers receive speculation prefetch rules; other browsers receive link prefetch hints. There is no prerendering. Hints are bounded per document and exclude external URLs, query strings, downloads, current-page anchors and slow/data-saving connections. Browsers decide whether to honor hints. Ordinary links work without JavaScript.

Docs search loads its browser module and compact index on demand, using **@zeruxjs/search** for local ranking. No third-party browser service is required. Run the production build before measuring output; development intentionally includes source maps and live reload.
