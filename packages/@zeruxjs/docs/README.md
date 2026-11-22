# @zeruxjs/docs

Version **0.0.4** supplies reusable documentation content, version-owned images,
headless navigation, safe Markdown, an optional responsive shell and explicit
static/search/browser adapters. It does not execute document code, download
images or claim Next.js/Nuxt parity.

## Public entries

| Import | Responsibility | Dependencies/ownership |
| --- | --- | --- |
| `@zeruxjs/docs` | Immutable catalogs, inheritance, snapshots, version comparisons, navigation and Fetch handlers | No server/filesystem/global registry on import |
| `@zeruxjs/docs/markdown` | Safe Markdown, headings, registered images, notices, code blocks and release diagnostics | No DOM or network access |
| `@zeruxjs/docs/zerux` | Article/full-document rendering, public route selection and temporary redirects | Optional ZeruxJS peer |
| `@zeruxjs/docs/build` | Referenced local image/CSS inventory with byte hashes | Explicit Node build operation; no downloads/copy/promotion |
| `@zeruxjs/docs/search` | Public-only per-release weighted local search | Optional `@zeruxjs/search` peer; returned scope owns its index |
| `@zeruxjs/docs/browser` | Disposable native code-copy controls | Explicit HTMLElement; native clipboard or host adapter |
| `@zeruxjs/docs/styles.css` | Optional scoped responsive/dark/forced-colors theme | Serve/copy explicitly; no automatic style injection |

Install optional peers only for the adapters you use. Node tooling requires
22.12+; root/Markdown/browser/search entries bundle without Node polyfills.
The package owns its declarations; DOM types belong only to the browser entry.

## Compose versions and reusable parts

```ts
import { createDocumentation, compareDocumentationVersions } from '@zeruxjs/docs';

const docs = createDocumentation({
  latest: 'v2', basePath: '/handbook', versions: [
    {
      id: 'v1', label: 'Version 1', status: 'archived',
      fragments: { ownership: ['The host owns authorization and cleanup.'] },
      images: { diagram: {
        src: '/handbook/assets/v1.png', width: 144, height: 64,
        alt: 'Content, rendering and output are connected.', access: 'public'
      } },
      documents: [{
        slug: 'intro', title: 'Introduction', access: 'public',
        description: 'A small versioned handbook.', section: 'Get started', order: 1,
        cover: 'diagram', keywords: ['installation'],
        parts: ['# Welcome', { include: 'ownership' }]
      }]
    },
    {
      id: 'v2', extends: 'v1', label: 'Current', status: 'stable',
      images: { diagram: {
        src: '/handbook/assets/v2.png', width: 144, height: 64,
        alt: 'Content, rendering and output are connected.', access: 'public'
      } }, documents: []
    }
  ]
});
console.log(docs.get('v2', 'intro')?.url); // /handbook/v2/intro/
console.log(compareDocumentationVersions(docs, 'v1', 'v2'));
```

Version IDs and image/part aliases are bounded identifiers. Page slugs additionally
support up to eight identifier segments (`guide/install`), at most 256 characters;
no traversal, encoded ambiguity, absolute URLs or filesystem loading occurs.
Mounts cap at 256 characters. Duplicate
identities, missing includes and inheritance/include cycles reject. A child
inherits pages, parts and images. Overrides affect only that version; image `null`
removes an inherited alias. Page `{slug, remove:true}` removes an inherited page.
Replacing a page replaces its metadata too. Release label/status/date are owned
by each release, not inherited from its parent. There is no missing-page fallback.

Page metadata supports `description`, `keywords`, `section`, integer `order`,
`hidden`, `searchable`, `toc`, related same-release slugs, cover image alias and
explicit `updatedAt`. Dates use real UTC `YYYY-MM-DD` calendar dates. No build-time
last-modified/release dates are invented. `hidden` only affects navigation;
`searchable:false` only affects search. **Neither is authorization.**

Release states `stable`, `preview`, `deprecated` and `archived` are descriptive
banners. `catalog.version(id)` exposes detached immutable release metadata and
`catalog.images(id)` exposes immutable image aliases; hosts authorize access to
catalogs containing private records. Identity and dynamic route lookups are indexed.

`documentationNavigation(catalog, version, slug?)` returns public, nonhidden
sections, breadcrumbs and previous/next links. Explicit order precedes slug ties;
sections follow their first ordered page and retain their pages together. Related
links are separate explicit relationships. Unknown/private/hidden current pages
have no adjacent-page disclosure. `compareDocumentation` keeps its original
page-diff shape; `compareDocumentationVersions` also compares image aliases and
release metadata without returning bodies or resolved image URLs.

## Registered images and versioned assets

Use `![Authored alternative text](asset:diagram)` or `cover: 'diagram'` with an
image's authored registry `alt`. Default unregistered image syntax stays inert alt
text. Images are private unless explicitly public. A meaningful image needs
Markdown/registry alt text; `decorative:true` deliberately emits empty alt. No
labels are invented from file names. Width/height are required bounded integers.

An image can declare `darkSrc` and up to eight `{src,width,integrity?}` candidates
in `sources`. Rendering adds lazy loading, async decoding, no-referrer policy,
width/height and optional native picture/srcset markup. These are browser hints,
not a guarantee of codec support, correct declared dimensions or no layout shift.
Duplicate responsive widths reject. Data/javascript URLs, credentials, query
strings/signed URLs, fragments, traversal and encoded path ambiguity reject.

Only canonical root-relative image URLs or HTTPS URLs are registered. Remote
browser requests need **explicit exact** `allowedImageOrigins` in the renderer;
otherwise even registered remote images remain alt text. Nothing is fetched on
the server. The host owns third-party consent, availability and asset licensing.
Dynamic Fetch handlers additionally require `imageOrigins` for CSP approval:

```ts
import { createDocumentationHandler } from '@zeruxjs/docs';
import { renderDocumentationDocument } from '@zeruxjs/docs/zerux';

const handler = createDocumentationHandler(docs, {
  imageOrigins: ['https://images.example'],
  render: page => renderDocumentationDocument(docs, page, {
    stylesheet: '/handbook/assets/docs.css',
    allowedImageOrigins: ['https://images.example']
  })
});
```

Private pages still need a fresh host `authorize` callback on every request.
Private-image rendering separately requires `includePrivateImages:true` after
page authorization; public page rendering never enables it. Private asset HTTP
access remains host-owned. Handler responses are private/no-store; denied/missing
pages return 404, private pages receive noindex, and GET/HEAD/405 are explicit.
Trusted host render callbacks are code, not a sandbox, and own their work limits.

## Markdown, notices and optional UI

Raw HTML is escaped. Code fences are escaped `pre/code` data with a validated
language label: no compiler, syntax package, shell or document code runs. GFM
notice quotes (`> [!NOTE]`, TIP, IMPORTANT, WARNING, CAUTION) render as native inert
asides. Links pass the security package's navigation URL policy.

`analyzeDocumentationMarkdown(body, options?)` returns rendered HTML, links,
headings, image references and fixed image issue codes. The article owns one H1;
body H1s become H2. Heading anchors preserve Unicode letters/marks/numbers,
normalize punctuation and append `--1`, `--2`, etc. Editing/reordering repeated
headings can change anchors. Standalone `renderDocumentationMarkdown` retains its
original heading levels/markup. It accepts the same explicit image policy.

`renderDocumentationDocument` adds a complete document (script-free by default), language,
escaped description, skip link and optional **local** stylesheet. The article
has native collapsible sidebar navigation, version links, breadcrumbs, optional
TOC, related pages and previous/next links. These remain readable without JS.
Serve the exported CSS yourself; override `.zerux-docs-layout` custom properties
such as `--docs-accent`, `--docs-background`, `--docs-text`, `--docs-border` and
`--docs-surface` in a later host stylesheet. Default CSS includes dark and
forced-colors policies and creates no motion. Hosts own final accessibility,
contrast, localization and browser qualification; default controls use English.

```ts
import { enhanceDocumentation } from '@zeruxjs/docs/browser';

const view = enhanceDocumentation(document.querySelector('.zerux-docs-layout')!);
// During host component teardown:
view.destroy();
```

Copying occurs only through a native button click. Unavailable clipboard support
produces disabled controls; denied writes produce fixed live-status feedback.
No clipboard reads, analytics or remote storage occur. At most one write is
pending. Optional AbortSignal/destroy removes owned controls/listeners and
ignores late completion, preserving authored attributes. Native clipboard writes
already started cannot be force-cancelled. A host can configure a local bundled
module URL with `renderDocumentationDocument(..., {script: '/assets/docs.js'})`;
the default Fetch CSP blocks scripts unless `enableLocalScripts:true` is explicitly
approved in `createDocumentationHandler`. Content cannot provide this option, and
inline/remote script URLs reject. Static exports stay script-free. A secure browser context/user activation
may be required. No button manufactures tab order or executes copied code.

## Local search

```ts
import { createDocumentationSearch } from '@zeruxjs/docs/search';

const search = createDocumentationSearch(docs, { version: 'v2', limit: 10 });
console.log(search.search('installation'));
search.destroy();
```

The existing search package owns Unicode tokenization and BM25 ranking; title,
keyword, description and body weights are 5/3/2/1. One staged per-release index
excludes private pages and `searchable:false` **before indexing**. Hidden public
pages remain searchable unless explicitly excluded. Queries cap at 512 characters
and 16 whitespace-separated terms, results at 50 and documents at 5000. The
underlying engine retains its own term/vocabulary/byte limits. Results are clones;
render their text fields as text, never HTML. Destroy releases only this index;
queries after disposal reject. There is no remote fallback, tracking or HTTP
endpoint automatically installed by the package.

## Static assets and export

`prepareDocumentationAssets` reads only referenced public local images under an
explicit absolute project root and public directory, deduplicates routes/releases and returns the
existing framework asset manifest/include contract. It never downloads, copies,
rewrites URLs or promotes output. Basic PNG/JPEG/GIF/WebP/AVIF signatures must
agree with extensions; this is not full decoding/dimension verification. SVG can
be rendered as a registered external image, but this helper rejects copying SVG:
use a separately reviewed/sanitized host asset pipeline for it.

Optional `integrity`/`darkIntegrity` pins and responsive source `integrity` values
are checked against actual SHA-256 bytes. Contradictory pins for a shared URL
reject. Without pins or content-addressed URLs, freezing metadata alone does not
freeze a mutable image's bytes. Keep historical binaries with their snapshots.

```ts
import { prepareDocumentationAssets } from '@zeruxjs/docs/build';
import { documentationStaticRoutes, documentationRedirects } from '@zeruxjs/docs/zerux';
import { exportStaticSite } from 'zeruxjs/static-export';

const pages = documentationStaticRoutes(docs, { validateLinks: true });
await exportStaticSite({
  rootDir: process.cwd(), origin: 'https://docs.example', outDir: 'out',
  ...pages,
  routes: [...pages.routes, ...documentationRedirects(docs, { landing: 'intro' })],
  assets: await prepareDocumentationAssets(docs, {
    rootDir: process.cwd(), directory: 'public'
  }),
  notFound: { access: 'public', view: {
    version: '', slug: 'missing', title: 'Not found', body: 'Page unavailable.',
    url: '/404.html', access: 'public'
  } }
});
```

Catalog image/page URLs contain their complete mount: leave the outer export
`basePath` at its default. Serve the same mount. The generic framework verifies
selected bytes again before staging/promotion. The adapter uses explicit routes and retains the framework
route/byte ceilings (currently 256 declared route patterns); larger catalogs need
an explicit host partition/enumeration plan rather than silent truncation.
Static exports require local vendored resources; approval for dynamic remote images is not offline vendoring.

For compatibility, `documentationStaticRoutes` defaults to primary-only image
markup. Set `responsiveImages:true` with the updated framework exporter in this
checkout, which validates at most eight selected local srcset candidates.
Its optional `document:{lang,stylesheets}` adds viewport/language and selected
local CSS in the document head. These additions require a matching framework
build, not an assumption that every older published 0.0.4 build has them. The
optional docs `stylesheet` renderer option also supports a body-safe link using
the legacy fragment contract; its CSS still must be explicitly inventoried.

`documentationRedirects` supplies temporary 302 latest/landing aliases. Its virtual
version alias cannot collide with a real release, and private targets reject.
Canonical version URLs stay immutable. Hosts mount these redirect declarations;
the helper does not start a listener. `zerux export`/`zerux serve-static` remain
explicit host CLI operations; dynamic rendering remains a normal Fetch consumer.

## Release checks and bounds

V1 snapshots remain readable. `snapshot()` expands parts and preserves image/page/
release metadata; `restoreDocumentation` revalidates. Save/review snapshots before
treating a release as frozen. `createDocumentationRelease` refuses invalid local
page/heading/image/related references, then returns one expanded release.
`validateDocumentationLinks` returns source slugs and fixed issue codes, never
fetching external links. Cross-version links need their target releases mounted.
Raw HTML links/custom host-renderer links are outside coverage. Snapshots may
contain private content; persistence, permissions and distributed locking stay
host-owned. Hashes verify bytes, not authorship or authorization.

Core bounds remain 32 versions, inheritance depth 8, 5000 pages/version, 10000
expanded pages, 2000 parts/version, 256 entries/part list, include depth 16 and
4096 expansions/page. Text caps at 1 MiB of UTF-16 units/page and 16 MiB combined;
image metadata at 8 MiB combined and 1000 aliases/version. Markdown additionally
caps 4096 headings/links, 256 image references, 200 code blocks and quote depth 16.
Image dimensions cap at 16384 and meaningful alt text at 512 characters. Build
inventory caps at 1000 assets, 16 MiB/file and 64 MiB total, rejecting symlinks,
traversal, missing files, changed read lengths and bad container/hash metadata.
The helper writes nothing. Host-owned trees must not mutate adversarially during
builds; no general filesystem sandbox/crash transaction is implied.

Run `npm run build` and `npm test` in this package. Regression checks use synthetic
catalogs/files, local search and jsdom. They do not certify browser clipboard
permissions, assistive technologies, external image providers or all codecs.
