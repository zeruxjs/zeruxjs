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

## Reuse content without changing old releases

Register `createDocumentation` using explicit version IDs, page slugs and named
parts. A page's `parts` array contains literal Markdown or `{include: 'part-id'}`.
Descendants can inherit pages and override parts. Save the expanded
`catalog.snapshot()` before treating a release as frozen; loading that snapshot
through `restoreDocumentation` does not depend on later shared-part edits.

```ts
import { createDocumentation } from '@zeruxjs/docs';
const docs = createDocumentation({
  latest: 'v1', basePath: '/manual', versions: [{ id: 'v1',
    fragments: { ownership: ['The host owns authorization and cleanup.'] },
    documents: [{ slug: 'intro', title: 'Introduction', access: 'public',
      parts: ['# Welcome', { include: 'ownership' }] }]
  }]
});
console.log(docs.get('v1', 'intro')?.url);
```

## Choose hosting independently

Use `createDocumentationHandler` in normal authorized framework Fetch routes.
Private pages require a fresh host policy and are private/no-store; the default
is denial. The `/zerux` adapter selects only public pages for the existing
`zeruxjs/static-export` API. `zerux export` loads explicit trusted build config;
`zerux serve-static` serves a verified output manifest without private services.
The same public catalog can be used by either mode.

The docs app consumes this catalog for reusable parts and delegates atomic output
publication to `zeruxjs/static-site`. Its authored navigation, theme, raw Markdown,
search and offline build remain application-owned. Version folders may define
`fragments.json`; front matter `parts` inserts registered reusable paragraphs
before the authored page body. No include reads an arbitrary file or module.

## Rendering boundaries

Safe Markdown escapes raw HTML, denies executable link schemes and renders images
as alternative text. The default fallback displays escaped text; host-rendered
components remain trusted code. Generated text is never evaluated. This package
provides bounded content composition, not framework parity, a CMS, automatic
translation, a browser hydration runtime or guaranteed factual documentation.

## Navigation and release review

Pages can declare `section` and integer `order`. The public
`documentationNavigation` helper supplies sections, breadcrumbs and adjacent
pages without including private titles. The optional framework article renderer
adds a table of contents, stable Unicode heading anchors and a single page H1.

Use `validateDocumentationLinks` and `createDocumentationRelease` from
`@zeruxjs/docs/markdown` to review local links and capture an expanded release.
Host persistence freezes that snapshot; editing shared fragments does not rewrite
saved releases. External links are not fetched or certified. Static consumers can
opt into preflight with `documentationStaticRoutes(docs, {validateLinks: true})`.
