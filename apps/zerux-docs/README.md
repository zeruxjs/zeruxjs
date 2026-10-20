# ZeruxJS documentation

A source-linked documentation site for the ZeruxJS runtime and its public ecosystem. Guides are authored Markdown documents, independent of the renderer. The application produces validated, fully rendered HTML for static hosting; package versions are unchanged.

## Run locally

From `apps/zerux-docs`:

```sh
npm run dev
```

Open the printed local URL (default `http://127.0.0.1:3011/zeruxjs/`). The development process watches Markdown, version reference snapshots and public assets, debounces rebuilds and retains the previous valid export on content errors. Renderer/configuration changes restart the Node watch process. Refresh the browser after a successful rebuild. Package README/manifest changes require a rebuild or dev restart.

```sh
npm run build
npm run check
npm run preview
```

`HOST` and `PORT` override the local preview listener. The preview supports nested pages, directory redirects, MIME types, GET/HEAD, and actual 404/405 responses. It is a development/preview tool, not a required production service.

## Static deployment

For an isolated docs preview, use the app commands below. For deployment, use the combined site builder in `pages/` and the GitHub Actions workflow documented in `SITE_DEPLOYMENT.md` at the repository root. The app output in `dist/` contains the `zeruxjs/` folder. Serve directory `index.html` files and configure `404.html` as the missing-page response. Do not configure an SPA fallback. The app is mounted at `/zeruxjs/`; `dist/zeruxjs/` must be served at that same path. The combined ecosystem builder puts the shared homepage at `/` and includes this app under `/zeruxjs/`. Set `site.origin` in `src/site.config.mjs` to your public domain origin before deployment to emit canonical/OG URLs and `sitemap.xml`; `robots.txt` then includes that sitemap. No domain is guessed for local builds.

Every document contains its full article, navigation, related links, source references and metadata in HTML. Search, code copying, package filtering, theme persistence and active-heading tracking are progressive enhancements. Reading and navigating require no JavaScript. No telemetry, external fonts or third-party browser services are loaded.

This is build-time server rendering/static generation. It is intentionally an app-specific exporter: `zerux build` compiles Node server applications and does not currently supply a generic static-export pipeline. These docs do not add React/Vue component rendering or hydration to the framework.

## Content structure

```text
src/
  site.config.mjs             Reads zerux.config.js and provides URL helpers
  docs/
    0.0.4/
      introduction.md         One Markdown document per topic
      tutorial.md
      package-cache.md
      ...
  lib/
    content.mjs               Metadata, sources and navigation validation
    markdown.mjs              Markdown rendering, safe links, heading anchors
    reference.mjs             Live/frozen package references
    template.mjs              Reusable layouts, portal and navigation
scripts/
  build.mjs                   Staging, rendering, validation and promotion
  check.mjs                   Static route/link/anchor/search verification
  snapshot.mjs                Freeze release references before version bumps
  serve.mjs                   Local preview and content/asset watching
public/
  favicon.svg
  assets/search.js
  assets/docs.js
```

The old `app/docs/` MDX drafts remain historical source material; the active content tree is `src/docs/`.

## Add or update a page

Create `src/docs/<version>/<slug>.md` with JSON metadata delimited by `---`:

```markdown
---
{
  "title": "Your topic",
  "description": "The task or contract this document explains.",
  "section": "Fundamentals",
  "order": 100,
  "sources": ["packages/zeruxjs/src/bootstrap/types.ts"],
  "related": ["routing", "request-lifecycle"]
}
---

## First section

Explain the behavior and its boundary. Link to [routing](routing.md).
```

The filename determines `/zeruxjs/docs/<version>/<slug>/`. Section names come from `site.config.mjs`; order controls navigation within a section. Sources must be real repository files for live versions. Related slugs must exist in the same version. For an ecosystem guide, add `"package": "@zeruxjs/cache"`; the builder appends the actual export map, runtime requirements and a collapsible README.

Use level-two/three headings, standard Markdown tables/lists/links and language-tagged code fences. A fence can include `title="app/page.ts"` to label a code block. Headings receive stable, deduplicated anchors. Raw HTML is escaped and MDX/JavaScript is not executed. Documentation links use `<slug>.md` and optional fragments; README-relative links resolve to their repository source.

Authored guides are mandatory for **every public package in a live workspace-backed version**, including CLI/tooling and placeholder packages. Adding a package without documenting it fails the docs build. Package name claims must be unique and refer to actual public manifests. Existing archived versions retain their reference behavior. Placeholder packages must document their real limited contract rather than inventing CMS/generator features.

## Documentation expectations

Document setup, a useful example, ownership/cleanup, error behavior, constraints and related tasks. Distinguish framework startup options from standalone factory options. Link the implementation and use public imports. Name callbacks and resources supplied by the application rather than implying they are built-ins. Make authorization, durability, transaction and coverage boundaries explicit where they matter.

The learning path covers installation, a working notes application, runtime architecture, file conventions, requests, configuration/environment, middleware, plugins, workers, data/services, frontend bridges, operations and API references. Each `@zeruxjs` package has an authored task-focused guide; the directory covers all 47 public packages. The homepage is a learning portal, not a generated manifest listing.

## Versioning and archived references

The live version reads local public manifests and READMEs. The framework version must match the live docs version, or the explicit `packageVersion` for unreleased preview docs; independently versioned packages retain their own manifest versions. Archived versions use frozen snapshots rather than newer workspace data.

Before bumping live package versions:

```sh
npm run snapshot -- 0.0.3
```

This creates a new `src/docs/0.0.4/reference.snapshot.json` without overwriting an existing snapshot. Commit it, set that version's `reference` to `snapshot`, and pin its `ref` to the release Git tag/commit in `zerux.config.js` under `documentation`. Then add the new version configuration/content folder and update `documentation.latest`. Frozen references are not read from newer workspace manifests. Version switching preserves the current slug when available, falling back to introduction.

Archive sources should use immutable Git refs. Edit links still target the docs source on master so corrections can be contributed.

## Verification and output contract

Every build validates metadata, source paths, related pages, package coverage, unique routes, unique IDs, local links, heading anchors, assets and search URLs **before replacing `dist/`**. A failed candidate leaves the previous export available. `npm run check` repeats export verification without rebuilding. The generated build manifest lists versions, routes and referenced packages.

Search indexes page titles, sections and heading-local prose for the current version. It is fetched only when a visitor searches. Links are ranked locally with bounded results and keyboard navigation. All result text is inserted with DOM text nodes. Clipboard and browser-local theme storage are optional; unavailable APIs do not prevent reading.

For presentation changes, verify desktop/mobile widths, keyboard focus, search close/Escape, theme choices, package filtering, code copy and JavaScript-disabled reading. Example syntax and public imports should be checked against the installed TypeScript declarations when changing APIs. A docs build does not run live database/Redis/SMTP/cloud integrations or certify their production behavior.

## Production assets and navigation

`prebuild` and `predev` compile the four required workspace tools in parallel. Production builds use **Zuixs** to generate the `ui-` utilities present in rendered HTML plus reusable utility recipes for document elements and component states. There are no handwritten CSS source files. `zuix.config.mjs` owns the utility prefix and breakpoints. **@zeruxjs/typescript** bundles browser modules and minifies CSS/JavaScript; development builds retain readable output and source maps. The asset manifest records sizes and content hashes used in cache-busting URLs. Production output has no source maps.

**@zeruxjs/performance/navigation** prefetches public documentation pages after hover or keyboard focus. Supporting browsers receive speculation prefetch rules; other browsers receive link prefetch hints. There is no prerendering. Hints are bounded per document and exclude external URLs, query strings, downloads, current-page anchors and slow/data-saving connections. Browsers decide whether to honor hints. Ordinary links work without JavaScript.

Docs search loads its browser module and compact index on demand, using **@zeruxjs/search** for local ranking. No third-party browser service is required. Run the production build before measuring output; development intentionally includes source maps and live reload.

### Utility-first styling

Use `ui-` utility classes in templates for new layouts and components. `zuix.config.mjs` defines theme extensions and imports `zuix.recipes.mjs`: reusable compositions of those same utilities for element selectors, Markdown typography, component states, dark mode, reduced-motion and print. This is the Zuixs equivalent of applying utilities to a reusable component; recipes preserve source order and are compiled before explicit template utilities. Style values and unsupported utility names are validated by Zuixs, and invalid recipes fail the build.

The build generates the final stylesheet (`site-assets/style.css` for the homepage, `assets/docs.css` for docs). Do not edit generated files. To change a component, change its recipe's `apply` tokens or its template classes. Use existing theme scales first, arbitrary values such as `ui-p-[13px]` for precise values, and properties such as `ui-[scroll-margin-top:96px]` where a named utility is unnecessary. `ui-!hidden` marks an important utility. State selectors and media/feature/container queries belong to the recipe configuration. No browser styling runtime is shipped.

## Raw Markdown URLs

Every document is exported as both `/zeruxjs/docs/<version>/<slug>.md` and `/zeruxjs/docs/<version>/<slug>/index.md`. `/zeruxjs/index.md` exports the handbook portal; the combined site also provides `/zeruxjs.md` and the ecosystem `/index.md`. Version introduction aliases are available at `/zeruxjs/docs/<version>.md` and `/zeruxjs/docs.md` for the latest version. These are real static files, not HTML pages disguised with a Markdown extension.

Markdown contains the title, description, authored content, public manifest references and package README where applicable. It excludes authoring front matter and HTML navigation chrome. Prose links are portable between flat and index aliases; fenced code examples are preserved. View Markdown works without JavaScript; Copy Markdown fetches content only after an explicit click. Missing files return a real 404.

Build manifests record SHA-256 hashes for every export. The docs checker, combined builder and GitHub Actions verify these before publishing; the publisher checks them again in the complete output-branch tree. `.nojekyll` is emitted in both static roots. The workflow uploads/deploys prebuilt files directly, without a Jekyll/Markdown rendering action. Local previews return `text/markdown`; the static hosting provider controls the deployed MIME header and whether a browser displays or downloads the file.

## Appearance and interaction

The homepage and docs share a system/light/dark preference stored under `zerux-theme`; existing `zerux-docs-theme` preferences migrate on use. A small early head script restores the preference before CSS paints. Storage is optional and no account, network call or cookie is needed. Without JavaScript, the operating system color scheme still applies. Shared build-time palette and motion recipes live in `scripts/site-design.mjs`, and browser controls in `scripts/site-theme.mjs`.

The interface uses indigo/teal accents, theme-aware surfaces, component hover feedback and short entry animations. Motion is enabled only when the visitor allows it. Page tools, a reading-position indicator and `/` or Cmd/Ctrl-K search shortcuts support navigation; typing in inputs does not trigger the `/` shortcut.

## Application configuration

`zerux.config.js` now owns the documentation settings under its app-specific `documentation` namespace. `src/site.config.mjs` imports that object; it is not an unused example. Keep the combined site mount aligned with `documentation.basePath`. See the authored `zerux-config` guide for config file precedence and runtime settings. This remains a static exporter built using workspace packages; adding the config does not turn `zerux build` into a general static-export command.

Production output now minifies HTML as well as CSS and JavaScript. The HTML pass compacts structural whitespace and comments while preserving `pre`, `textarea`, script and style payloads; line breaks inside code examples remain intentional. Development HTML remains readable. The native version disclosure gains outside-click, focus-out and Escape dismissal when JavaScript is available.

The framework configuration is primarily for runtime service startup: database, cache and other settings. This static app consumes only `documentation` and never calls `bootstrapApplication`/`initializeRuntimeServices`; adding service configuration does not activate services here. The docs currently require no database/cache connection. A server-backed version must start the actual Zerux runtime; GitHub Pages serves the generated static files.

## Detailed configuration and package coverage

The Configuration navigation group contains a handbook, complete local/production-shaped examples and individual database, cache, files, email, analytics, tags, reports, queue, server, structure, theme, protocol, worker and auth/security chapters. Each separates actual runtime consumption from declared/custom settings and standalone factories. The TypeScript guide covers strict NodeNext checking, typed config, public option/result inference and unknown-data validation.

Every public package now has an authored setup/status page. Preserve established `reference-*` slugs when replacing generated reference content so published URLs remain valid. Package sections cover installation, actual integration path, TypeScript, operations/lifecycle and relevant public option types. Source-backed field tables describe declared values; optional is not a default and a root index signature is not feature activation. Update both prose and option contracts when source APIs change, and freeze release references before a version bump.

Portal learning paths are defined once in `src/lib/learning-paths.mjs` and shared by the HTML and raw Markdown portal, avoiding mismatched navigation as the handbook grows. Validate self-contained examples with the installed public declarations; report real integration/browser checks separately from typechecks.


Documentation retention: keep major/minor documentation lines, with only the latest patch for each retained line. The current 0.0 line is documented at 0.0.4; 0.0.2 is removed rather than duplicated.

This branch previews docs 0.0.4 with `packageVersion: "0.0.3"`, so package installation examples and generated references remain truthful without a package release. Source links target `version/v0.0.4`.
