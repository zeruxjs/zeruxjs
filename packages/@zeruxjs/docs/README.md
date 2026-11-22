# @zeruxjs/docs

A headless, versioned documentation catalog with reusable Markdown parts. Root
imports own no server, filesystem, storage, watcher or global registry. The
package supplies content contracts; it does not claim Next.js/Nuxt parity.

## Catalog and reusable parts

```ts
import { createDocumentation, compareDocumentation } from '@zeruxjs/docs';

const docs = createDocumentation({
  latest: 'v2', basePath: '/handbook',
  versions: [
    { id: 'v1', fragments: { ownership: ['The host owns authorization and cleanup.'] },
      documents: [{ slug: 'intro', title: 'Introduction', access: 'public',
        parts: ['# Welcome', { include: 'ownership' }] }] },
    { id: 'v2', extends: 'v1', documents: [
      { slug: 'install', title: 'Installation', access: 'public', parts: ['Install your application dependencies.'] }
    ] }
  ]
});
console.log(docs.get('v2', 'intro')?.url); // /handbook/v2/intro/
console.log(compareDocumentation(docs, 'v1', 'v2'));
```

Version IDs and page slugs are explicit, bounded identifiers, not filesystem
paths. Order of registration does not determine output. Duplicate declarations,
unknown parents/includes and cycles reject. Descendants inherit pages and parts;
a descendant part override recompiles its inherited pages against that override.
It does not change its parent. Replace an entire page by declaring its slug again,
or explicitly remove an inherited page using `{slug, remove:true}`. There is no
silent fallback to another release when a page is missing.

`catalog.snapshot()` returns detached, expanded schema-version-1 data.
`restoreDocumentation(snapshot)` validates it again. Persist/review snapshots to
freeze released prose before editing shared parts; the package does not write
history, invent revision authors or provide distributed locking. Snapshot contents
can include private pages: authorize access before exposing or persisting them.

Limits: 32 versions, inheritance depth 8, 5000 pages per version, 10000 expanded
pages overall, 2000 parts per version, 256 entries per part list, include depth
16 and 4096 expansions per page. A page caps at 1 MiB of UTF-16 units and combined
literal expansion at 16 MiB. Bounds are character budgets, not token estimates.
Plain data and dense arrays are required; getters/custom iterators reject.

## Markdown and host components

`@zeruxjs/docs/markdown` exports `renderDocumentationMarkdown(body)` using Marked.
Raw HTML is escaped. Executable URL schemes reject; images become alternative
text rather than automatically loading remote resources. Code/document text is
never executed. This is a deliberately limited rendering policy, not permission
to insert arbitrary HTML. Trusted host components/renderers are supplied as code
through `createDocumentationHandler` options, never imported from saved content.

`renderDocumentationPage` is the dependency-light escaped-text fallback.
`renderDocumentationArticle` from `/zerux` adds native link navigation between
public pages and available versions with safe Markdown. Hosts own themes, CSS,
search UI, accessibility qualification and optional client enhancements. Rendering
does not manufacture missing author information or validate technical claims.

## Dynamic and static consumers

`createDocumentationHandler(catalog, {authorize, render})` returns a Fetch
handler for exact catalog URLs. GET/HEAD are supported, unsupported methods return
405, missing/denied pages return 404. Every response is private/no-store. Pages
are **private by default**; private pages require a fresh host authorization
callback on every request. Mounting a route is not authentication.

```ts
import { exportStaticSite } from 'zeruxjs/static-export';
import { documentationStaticRoutes } from '@zeruxjs/docs/zerux';

// Use the catalog defined above. This is an explicit host build operation.
await exportStaticSite({
  rootDir: process.cwd(), origin: 'https://docs.example', outDir: 'out',
  ...documentationStaticRoutes(docs),
  notFound: { access: 'public', view: {
    version: '', slug: 'missing', title: 'Not found', body: 'Page unavailable.',
    url: '/404.html', access: 'public'
  } }
});
```

The optional ZeruxJS peer is required only for `/zerux`; core/Markdown imports do
not load it. Only explicitly public pages become export routes. Catalog URLs
already contain the complete mount, so leave the outer exporter `basePath` at
its default rather than prefixing the mount twice. The framework owns enumeration,
render validation, deterministic output, atomic promotion and output manifests.
Run `zerux export` with a trusted `zerux.static.ts/js` configuration, then
`zerux serve-static --dir out` for public output without services. Dynamic handlers
remain normal application routes; static exports never bootstrap private services.

## Verification and limits

Build with `npm run build`; run `npm test` for focused catalog, denial, corrupt
snapshot, renderer-failure and inert-Markdown checks. No browser/assistive-
technology, external provider, deployment or complete documentation-framework
qualification is claimed. Node builds require 22.12+; core and Markdown modules
are DOM-free and can be bundled for browsers. Hosts own persistence, filesystem
loading, content permissions, backups and tenant isolation. Host callbacks are
trusted application code, not a JavaScript sandbox.

## Navigation, headings and release checks

Pages accept optional `section` (nonempty label up to 128 characters) and `order`
(integer -1000000 through 1000000). `documentationNavigation(catalog, version,
slug?)` returns public-only sections, breadcrumbs and previous/next pages. Order
is ascending with locale-independent slug ties. Sections follow their first ordered
page, then keep their pages together; adjacent links use that same reading order.
Missing/private current pages
have no adjacent links. A replacement page explicitly supplies its own metadata.
These optional fields round-trip through existing V1 snapshots; old snapshots
without them still load. `compareDocumentation` includes navigation changes.

The `/zerux` article renderer owns the page H1. Body H1 headings become H2;
remaining heading levels stay authored. `analyzeDocumentationMarkdown` from
`/markdown` returns the exact HTML, heading inventory and literal Markdown links.
The article adds a table of contents. Anchors preserve Unicode letters, marks and
numbers, normalize punctuation to hyphens, and append `--1`, `--2`, etc. for
collision-free identities. Editing/reordering repeated headings can change anchors;
review link diagnostics before publishing. The standalone
`renderDocumentationMarkdown` retains its original heading levels and markup.

```ts
import { createDocumentationRelease, validateDocumentationLinks }
  from '@zeruxjs/docs/markdown';

const issues = validateDocumentationLinks(docs, 'v2');
const release = createDocumentationRelease(docs, 'v2');
// Host reviews/persists release with create-only ownership; no file is written here.
```

Release checks report source slugs and fixed codes for missing pages/headings,
public links to private targets and invalid destinations. They resolve relative
and cross-version **literal Markdown links** inside the catalog mount. They never
fetch external URLs or certify host routes outside that mount. Raw HTML links,
custom host-renderer links and external availability are outside coverage.
Snapshots can contain private prose; run these authoring APIs only with authorized
access. One-release snapshots retain links to other releases, so hosts must keep
those linked releases mounted. Released content is frozen only when the host
persists the expanded snapshot and later restores it rather than recompiling
editable shared fragments. No distributed release lock or historical authorship
is inferred.

Use `documentationStaticRoutes(docs, {validateLinks: true})` to reject a broken
candidate before the framework exporter acquires output resources. Validation is
opt-in for existing consumers. Dynamic handlers pre-index exact URLs once while
reauthorizing private pages per request; catalog identity lookups are also indexed.
