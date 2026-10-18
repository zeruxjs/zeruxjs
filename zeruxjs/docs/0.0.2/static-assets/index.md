# Static assets and private files

Choose direct public assets, authorized downloads or build-time documentation output.


## Public directory

Use public for CSS, browser JavaScript, icons and other intentionally public bytes. The runtime discovers these files and serves matching paths before normal application route dispatch. If public/logo.svg is present, it can be served as /logo.svg.

## Public is not private

Do not put user uploads, environment files, backups, session exports or runtime snapshots in public. An authentication middleware in an application route does not turn direct public files into private downloads. Use files/media Fetch handlers with authorization for protected content.

## Production compilation

zerux build copies supported application sources and public assets into the staged server build. It refuses symlinked sources and secret-looking file names under build sources and enforces file/count/byte limits. These checks are guardrails, not a substitute for reviewing source directories.

## Browser assets

HTML pages must explicitly include stylesheets/scripts they need. The runtime does not automatically bundle an application component tree or optimize image/font assets. The font, SEO and asset catalog packages help with focused tasks; the application still hosts binaries and supplies correct HTML/CSP.

## This documentation app

Its exporter copies public assets and renders known Markdown documents into dist. Directory index.html files serve nested routes directly; configure a real 404 page and avoid SPA history fallback. This app is mounted at /zeruxjs/; its generated links, assets and search URLs include that prefix. The combined ecosystem homepage owns the domain root.

## Configure public discovery deliberately

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';
export default {
  structure: { public: ['public'] },
} satisfies ZeruxConfig;
```

TypeScript validates the path shape, not the contents of that directory. Audit the actual exported files and keep environment files, backups, source credentials and authenticated uploads outside it. A filename or signed-looking URL is not an access-control check.

## Static versus server-generated assets

The server runtime can discover configured public files; the docs exporter copies only its approved public build tree and generated assets. Neither operation automatically bundles every referenced JavaScript dependency, converts arbitrary Markdown, optimizes image bytes or provisions object storage. Generate browser CSS/JS and link the output with stable base-path-aware URLs.

Use content versioning for reusable immutable assets and verify MIME/content type through the actual host. A local preview can set text/markdown while a static provider chooses another display/download behavior. Keep .nojekyll and prebuilt artifact deployment for the docs raw Markdown exports; a second site generator can otherwise change the artifact contract.

Test nested paths, directory redirects, absent assets, HEAD and the configured static 404 response. A single successful homepage request does not prove fonts, modules, images or mounted documentation paths exist in the production tree.


## Implementation sources

- [packages/zeruxjs/src/bootstrap/runtime.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/runtime.ts)
- [packages/zeruxjs/src/commands/project-builder.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/commands/project-builder.ts)
- [apps/zerux-docs/scripts/build.mjs](https://github.com/zeruxjs/zeruxjs/blob/master/apps/zerux-docs/scripts/build.mjs)
