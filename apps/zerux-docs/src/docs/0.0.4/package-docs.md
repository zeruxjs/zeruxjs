---
{
  "title": "Versioned documentation",
  "description": "Build reusable, versioned public documentation with explicit dynamic and static hosting.",
  "section": "Packages",
  "order": 1,
  "package": "@zeruxjs/docs",
  "sources": [
    "packages/@zeruxjs/docs/README.md",
    "packages/@zeruxjs/docs/src/index.ts",
    "packages/@zeruxjs/docs/src/navigation.ts",
    "packages/@zeruxjs/docs/src/markdown.ts",
    "packages/@zeruxjs/docs/src/zerux.ts",
    "packages/@zeruxjs/docs/src/images.ts",
    "packages/@zeruxjs/docs/src/build.ts",
    "packages/@zeruxjs/docs/src/browser.ts",
    "packages/@zeruxjs/docs/src/search.ts",
    "packages/zeruxjs/src/static-site.ts"
  ],
  "related": [
    "deploy-static",
    "packages"
  ],
  "parts": [
    {
      "include": "documentation-boundaries"
    }
  ]
}
---


## Versioned content and images

`@zeruxjs/docs@0.0.4` provides explicit release catalogs, inherited paragraph parts,
registered per-version images and immutable expanded V1 snapshots. Children can
replace/remove image aliases without changing their parent. Store snapshots and
historical binaries before calling a release frozen; metadata alone does not pin
mutable image bytes unless integrity is declared and enforced.

```ts
import { createDocumentation, compareDocumentationVersions } from '@zeruxjs/docs';

const docs = createDocumentation({
  latest: 'v1', basePath: '/manual', versions: [{
    id: 'v1', label: 'Current', status: 'stable',
    fragments: { ownership: ['The host owns authorization and cleanup.'] },
    images: { overview: {
      src: '/manual/assets/overview.png', width: 144, height: 64,
      alt: 'Three connected content, rendering and output blocks.', access: 'public'
    } },
    documents: [{ slug: 'guide/start', title: 'Getting started',
      access: 'public', section: 'Guide', order: 1, cover: 'overview',
      description: 'An explicit versioned handbook.',
      parts: ['# Welcome', { include: 'ownership' }]
    }]
  }]
});
console.log(docs.get('v1', 'guide/start')?.url);
```

Markdown references use `![Authored alt](asset:overview)`. Width/height, decorative
intent and public/private resource policy are explicit. Optional dark sources and
responsive width candidates share the same URL/origin policy. Unregistered images
stay inert; remote HTTPS images require an exact host allowlist and matching CSP.
The package never downloads them. The optional build helper accepts local passive
raster assets, rejects SVG copying and verifies declared hashes; hosts remain
responsible for licenses, complete decoding and actual dimensions.

## Render and enhance explicitly

`renderDocumentationDocument` from `/zerux` renders a complete document with native
sidebar/version navigation, breadcrumbs, TOC, related pages and adjacent links.
The optional exported `styles.css` scopes theme variables and includes responsive,
dark and forced-colors styling. Page H1 ownership, Unicode anchors, GFM notices
and escaped language-labelled code fences are shared with the Markdown renderer.
No code fences, stored HTML or content callbacks execute.

`enhanceDocumentation` from `/browser` adds owned code-copy buttons only after an
explicit DOM mount. Clipboard absence/denial is visible. Destroy/AbortSignal removes
owned listeners and nodes while preserving authored attributes; already-started
native clipboard work cannot be force-cancelled. A host-authored local module can
be configured separately from content; default Fetch CSP still blocks scripts
unless `enableLocalScripts:true` is explicitly approved. Static exports stay
script-free. DOM-emulation tests do not certify real clipboard/AT behavior.

## Select public search and static ownership

`createDocumentationSearch` from `/search` optionally consumes the existing local
search package, with explicit weighted fields and a separate per-release index.
Private pages and `searchable:false` pages are excluded before indexing. Results
are bounded clones; destroy owns only this scope's index. There is no provider,
remote fallback or automatic analytics collection.

`prepareDocumentationAssets` from `/build` inventories only referenced public local
images plus explicitly selected CSS. It produces framework-compatible integrity
metadata; the existing exporter owns verification/copy/staging/promotion. Generic
static export additionally supports declared document language/stylesheets and
bounded selected local srcset candidates in the matching framework source build.
The docs adapter defaults to primary-only images for older export compatibility.
Catalog URLs already contain the full non-root mount; leave the outer exporter
basePath at its default.

`documentationRedirects` optionally declares temporary latest/landing aliases;
private targets and collisions with real releases reject. `hidden` affects only
navigation and `searchable` only local search: neither is authorization. Dynamic
private pages require fresh host authorization and remain private/no-store/noindex.

## Review releases rather than inventing history

`validateDocumentationLinks` and `createDocumentationRelease` from `/markdown`
check local page/heading/image/related references without fetching external URLs.
`compareDocumentationVersions` reports page/image alias and release-metadata
changes. Dates remain authored facts. Hosts own snapshot persistence, tenant
isolation, release locking, asset licensing and historical resource retention.
