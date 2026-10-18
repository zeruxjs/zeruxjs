---
{
  "title": "Build and deployment",
  "description": "Choose a server build or a fully static documentation export.",
  "section": "Operations",
  "order": 140,
  "sources": [
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/bootstrap/types.ts"
  ],
  "related": [
    "introduction",
    "deployment"
  ]
}
---

## Framework server build

zerux build compiles routes, controllers, plugins and public assets into .zerux/build. A successful build replaces the prior output; failed compilation leaves the last good build. zerux start consumes the build manifest when it exists. The current resolver can fall back to source configuration when no manifest exists, so verify your deployment actually contains a valid build; start alone is not proof of compiled execution. Run typechecking separately.

```sh
npx zerux build
npx zerux start
```

## Static documentation build

In apps/zerux-docs, npm run build renders every documentation route into dist/zeruxjs/<route>/index.html, along with CSS, search data and a 404 page. It uses no browser hydration and needs no runtime server on the deployment host.

```sh
cd apps/zerux-docs
npm run build
# The combined site workflow publishes dist/zeruxjs/ under /zeruxjs/.
# Optional local preview:
npm run preview
```

## Hosting

For documentation, serve directory index.html files and use dist/404.html as the missing-page response. Do not configure an SPA fallback: every page is already rendered. For framework applications, configure TLS, application domains, process restarts and service credentials at the host.

## Build a reproducible artifact

Start from the committed application manifest and lockfile, install its dependencies, run a separate typecheck and build the production application. The server compiler is not the docs static exporter; deploy the artifact appropriate to the app you are actually hosting. Keep source, runtime output, private uploads and configuration secrets in distinct locations.

Use a supported Node runtime for the chosen adapters. Native SQLite or optional binary tooling can behave differently on a clean machine and operating system, so verify the installed production dependency set rather than relying on a workspace symlink or development cache.

## Supply private configuration at startup

Set deployment environment values through the process/secret store and load one authoritative zerux.config file. Check database, cache, queue and email readiness policies before serving traffic. A compiler build does not prove the external services are reachable with the deployment identity.

TypeScript configuration can use satisfies ZeruxConfig and narrower service types, but the generated JavaScript still reads environment values at runtime. Additional structure.env loading order differs from direct imports/builds. Avoid copying private environment files into a static public folder to make a missing value disappear.

## Proxy, permissions and lifecycle

Configure DNS, TLS, host forwarding and allowedDomains consistently. Keep internal developer tools and protected dashboards behind explicit application authorization/network policy. Run with filesystem permissions limited to required output/storage paths; a local development proxy is not automatically the production security boundary.

Test graceful shutdown while requests, streams and workers are active. Verify owned connections close and pending jobs follow their delivery/idempotency policy. Establish backups and a tested restore path for persistent data, not only a source-code rollback.

## Static docs deployment

The repository docs build renders HTML and raw Markdown, minifies production HTML/CSS/JS and validates links/content hashes. GitHub Pages deploys static files, so no database/cache runtime starts there. The zerux.config documentation namespace configures that exporter only. See the repository SITE_DEPLOYMENT.md for the shared root and per-site mounts.
