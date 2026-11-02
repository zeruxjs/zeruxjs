# RSS, Atom and JSON feeds

Publish public content with negotiated representations and cache validators.


## Model the publication

```ts
import { createRssFeed } from '@zeruxjs/feed';
const xml = createRssFeed({ title: 'Updates', description: 'Product news',
  siteUrl: 'https://example.com', feedUrl: 'https://example.com/feed.xml',
  items: [{ id: 'release-1', title: 'First release',
    url: 'https://example.com/releases/1', date: new Date() }] });
```

Equivalent generators cover Atom 1.0 and JSON Feed 1.1. URLs must be credential-free HTTP(S); dates and enclosure sizes are validated. Keep entry IDs stable as content changes.

## Fetch publication

createFeedFetchHandler from @zeruxjs/feed/fetch supports a fixed format or Accept negotiation. It handles GET/HEAD, 405, 406, ETags, Last-Modified, Vary: Accept and public cache lifetimes. Set a maximum item count and supply a current publication function.

## Scope

Only publish content intended for all feed readers. Personalized feeds require an application-specific private response/cache policy. Feed generation does not send SSE, schedule polling or notify subscribers automatically.

## Install and select the integration

```sh
npm install @zeruxjs/feed@0.0.4
```

There is no automatic `feed` startup service in `zerux.config.js` for this package. Import its public APIs and create the object or browser controller in the application owner that needs it. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reference.md) and [TypeScript](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md).

## A practical integration workflow

Build a feed from published public items with stable IDs, valid HTTP(S) URLs, dates and the correct feed/site origin. Choose RSS, Atom or JSON Feed for the client population; use the Fetch helper when negotiation, HEAD and conditional responses are needed. Supply a changing content function rather than a stale array when publication can change.

## TypeScript: inputs, results and ownership

```ts
import { createRssFeed } from '@zeruxjs/feed';

type Inputs = Parameters<typeof createRssFeed>;
type Result = Awaited<ReturnType<typeof createRssFeed>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createRssFeed>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Keep public feed helpers separate from personalized/private feeds. A crawler or RSS client may cache content after publication, so do not include unpublished fields or assume later deletion revokes copies. Test Accept negotiation, 406, representation-aware Vary, ETag/304 and item/date/size limits. Feed generation does not create an SSE/WebSocket subscription.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### FeedOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `title` | `string` | No |
| `description` | `string` | No |
| `siteUrl` | `string` | No |
| `feedUrl` | `string` | Yes |
| `language` | `string` | Yes |
| `copyright` | `string` | Yes |
| `image` | `string` | Yes |
| `updated` | `string\|Date` | Yes |
| `items` | `FeedItem[]` | No |

### FeedItem

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `id` | `string` | No |
| `title` | `string` | No |
| `url` | `string` | No |
| `description` | `string` | Yes |
| `contentHtml` | `string` | Yes |
| `date` | `Date \| string` | Yes |
| `updated` | `Date \| string` | Yes |
| `author` | `string` | Yes |
| `tags` | `string[]` | Yes |
| `image` | `string` | Yes |
| `enclosure` | `{url:string;type:string;length:number}` | Yes |

## Choose deliberate format coverage

The package README provides a precise RSS/Atom/JSON Feed compatibility matrix.
Structured authors/categories/attachments supplement legacy author/tags/enclosure
fields. RSS supports one enclosure and rejects multiple; Atom/JSON support multiple.
Person email/URI/avatar and category label/domain have format-specific mappings,
not a promise that every field survives every representation.

Set strict:true for Atom author, absolute IRI identity and known timestamp checks.
Default legacy mode preserves opaque IDs/missing authors and deterministic epoch
fallback, which is not a content fact or a full Atom-validity claim. Duplicate
logical IDs reject; supplied atomId values must also be unique. No ID or timestamp
is randomized at build time. Only validated authored dates drive Last-Modified.

Use contentText or host-sanitized contentHtml. XML escaping prevents markup from
breaking the feed document but does not sanitize HTML that readers later render.
Attachment URL/MIME/length are validated metadata, not permission to fetch a file;
generation performs no remote inspection. Do not publish signed/private URLs.

Fetch publication preserves weighted Accept, representation ETags, HEAD/304 and
Vary behavior, adds explicit truncation reporting and bounded producer cancellation,
and returns redacted 503 on dependency failure. Await handler.close during teardown;
actual producer settlement owns capacity and borrowed resources remain with the
host. This public helper does not authenticate a tenant or personalize a feed.
The public-import example covers strict authored publication; parser/HTTP fixtures
are separate from live reader or HTML-sanitizer qualification.


## Public entry points

Manifest reference for `@zeruxjs/feed@0.0.4`.

```json
{
  "exports": {
    ".": "./dist/index.js",
    "./fetch": "./dist/fetch.js"
  },
  "engines": {},
  "dependencies": {},
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/feed

Modular RSS 2.0, Atom 1.0, and JSON Feed 1.1 generators.

```ts
import { createRssFeed, createAtomFeed, createJsonFeed, createFeedResponse } from '@zeruxjs/feed';
const config = {
  title: 'Updates', description: 'Product releases', siteUrl: 'https://example.com',
  feedUrl: 'https://example.com/feed.xml',
  items: [{ id: 'release-1', title: 'Version 1', url: 'https://example.com/releases/1', date: new Date() }],
};
const xml = createRssFeed(config);
const http = createFeedResponse('rss', config, 300); // { status, headers, body }
```

Separated into types, validation/XML escaping utilities, RSS, Atom, JSON Feed, content types and HTTP helpers. URLs must be HTTP(S) and cannot contain credentials. Date and enclosure size validation are included.

## Fetch-compatible publication endpoints

```ts
import { createFeedFetchHandler } from '@zeruxjs/feed/fetch';
const feed = createFeedFetchHandler({
  feed: () => getPublishedArticles(),
  format: 'negotiate', // RSS, Atom or JSON Feed from Accept
  maxItems: 1000,
  cacheSeconds: 300
});
```

Supports GET/HEAD/405, quality-weighted Accept negotiation (406 for unacceptable types), ETag/304, Last-Modified conditional responses, representation-aware `Vary: Accept`, public caching and input limits. Supply only public feed content; personalized or authenticated feeds should be handled by application-specific private routes instead of these public helpers. This does not push SSE/WebSocket updates.

## Format coverage and explicit compatibility

See the runnable [public-import example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/feed/examples/publication.ts). Generators
preserve authored item/author/category/attachment order and do not fetch images,
author URLs or enclosure files. The model is deliberately a subset of
[RSS 2.0](https://www.rssboard.org/rss-2-0-11),
[Atom 1.0](https://www.rfc-editor.org/rfc/rfc4287) and
[JSON Feed 1.1](https://www.jsonfeed.org/version/1.1/):

| Field | RSS | Atom | JSON Feed |
| --- | --- | --- | --- |
| Identity | item.id as opaque guid, isPermaLink=false | feed id or siteUrl; item.atomId or item.id | item.id string |
| Authors | repeated Dublin Core creator names; one item email also emits standard author | multiple name/uri/email, feed inheritance | multiple name/url/avatar, feed/item inheritance |
| Categories | feed/item term, optional domain from scheme | feed/item term, scheme, label | item terms as tags; no feed taxonomy field |
| Language | channel language; item dc:language extension | feed/entry xml:lang | feed/item language |
| Attachments | one enclosure: URL, MIME, byte length | multiple enclosure links plus optional title | multiple attachments plus title/duration seconds |
| Content | description/plain text, content:encoded HTML extension | summary; text or escaped HTML content | content_text/content_html |
| Dates | pubDate and known-content lastBuildDate | updated/published | date_published/date_modified |
| Images | channel image | feed logo | feed icon/item image and author avatars |

Email has no JSON Feed author field; avatar has no Atom/RSS person field; category
labels and attachment duration/title have only the mappings listed. Unsupported
podcast/media extension vocabularies, contributors, source records, RDF feeds,
streaming feeds and complete reader/vendor parity are not claimed. RSS rejects
multiple attachments rather than silently discarding all but one.

Legacy `author:string`, `tags:string[]` and `enclosure:{url,type,length}` remain
supported. New structured fields are `authors`, `categories`, `attachments`,
`contentText`, `language`, feed `id` and item `atomId`. Legacy author/enclosure
cannot be combined with their structured replacements on the same item. Tags and
categories append in declared order. URLs are absolute HTTP(S), credential-free
and bounded; language uses canonical BCP 47. MIME is a bare type/subtype, without
parameters. Attachment length is a safe nonnegative integer; duration is a finite
nonnegative number up to ten years. Metadata does not grant fetch/download access.

### Stable IDs, dates and strict Atom

Duplicate item IDs reject by exact case-sensitive string comparison; Atom also
rejects duplicate effective atomId values. No random IDs or build-time timestamps
are generated. Feed authors and IDs must be content-owned facts, not guessed from
an address/path. For standards-oriented Atom output, set **strict:true**: it
requires feed authors or authors on every entry, a known feed update time and an
own date/updated on every entry, plus absolute HTTP(S), urn or tag identifiers.
Feed id defaults to the validated site URL if not explicitly supplied. ID checks
are a narrow absolute-IRI policy, not validation of every possible IRI scheme.

For API compatibility, default/false Atom mode still permits legacy opaque IDs,
missing authors and an epoch fallback when no update facts exist. That fallback
is deterministic, **not a real content modification date**; this legacy mode is
not a claim of full Atom validity. Existing root imports/factories remain usable.

Dates accept valid Date objects or supported ISO calendar dates/RFC3339-style
strings with seconds, optional 1–3 millisecond digits and explicit timezone.
Date-only input normalizes to UTC midnight. Impossible calendar dates and hour
24 reject rather than rolling forward; ambiguous natural-language dates are not
accepted. updated/HTTP Last-Modified uses the maximum supplied feed/item update
or publication date, not generation time. For title/author/other metadata changes,
the host must advance its authored update date; the helper cannot infer that fact.
ETags still reflect every serialized byte. With no known dates, HTTP Last-Modified
is omitted. JSON Feed items without supplied text/HTML use their known title as
minimal content_text to satisfy the required content-field shape.

### Untrusted HTML and runtime bounds

contentHtml is **not sanitized**. XML escaping keeps it within a text node; a feed
reader may decode and render that HTML. The host must sanitize untrusted HTML
before publishing, or use contentText. RSS readers may also treat descriptions as
HTML. Receivers must sanitize before rendering; XML escaping is not an HTML
sanitizer or script encoder. JSON output must not be inserted directly into an
HTML script block. The verified security package's context-specific encoders and
validator HTTP boundaries remain separate contracts; no homemade HTML sanitizer,
remote inspection or application authorization is introduced here.

All generators validate runtime records, plain dense arrays, dates, URL schemes,
MIME, finite numbers and duplicate identities before serialization; accessors,
class records, unknown fields and unsafe XML text reject. Defaults are 10000 items
and 8 MiB output, configurable with FeedOptions.maxItems/maxBytes up to 10000 and
64 MiB. Selected item input caps at 16 MiB. Authors cap at 32, tags/categories at
100 each, attachments at 16, URLs at 8192 characters and text/HTML bodies at 1 MiB
per field. Output limits describe returned payload bytes, not total JS heap.

### Fetch negotiation, producer ownership and failures

The existing callable createFeedFetchHandler now also has `close()` and `status()`.
Sources may remain zero-argument callbacks, or accept `{signal}`. No request/tenant
identity is inferred. Only public content belongs in this handler: host filtering,
consent and authorization must happen before publication. Requests carrying Cookie
or Authorization receive private,no-store as a defensive cache boundary, not as
an authentication check. Use an explicitly authorized private route for personalized
feeds. Never put signed URLs, private subjects or credentials into a public feed.

GET/HEAD negotiate the three declared MIME types with quality and specificity;
exact q=0 exclusions override wildcards, malformed/out-of-range qualities reject
the range, and unavailable Accept values return 406 before calling the producer.
Negotiated responses vary on Accept. Format-specific ETags, weak If-None-Match,
If-Modified-Since precedence and body-free HEAD/304 are supported. Source order is
preserved, so stable content/config/order yields stable representation ETags.
The Fetch maxItems option selects the first N items as before; truncation is now
reported with X-Feed-Truncated:true, and uniqueness applies to the emitted prefix.
Source arrays cap at 10000. Invalid formats reject instead of falling through to
JSON.

Fetch settings add maxBytes (8 MiB default, 64 MiB maximum), timeoutMs (5000 default,
1–60000) and maxPending (8 default, 1–128). Supplier errors, invalid selected content,
overload and cancellation/deadlines return body-free no-store 503 without raw causes.
Capacity remains occupied until the producer actually settles. close stops new
calls, aborts cooperative producers and drains native settlement; a noncooperative
callback can delay close. It does not close host databases/HTTP clients or forcibly
stop JavaScript. Imports and fixed-feed generation own no network resources.

Qualification uses the development-only Saxes namespace-aware XML parser, JSON.parse,
format assertions and focused HTTP/ownership fixtures. It covers special characters,
strict missing facts, duplicates, invalid dates/MIME/URLs, limits, 304/HEAD/406,
partial Accept exclusions, outages and drain. XML parsing proves well-formedness,
not full schema validation or all-reader interoperability. No live feed reader,
browser HTML sanitizer or remote enclosure service was exercised; the host must
qualify those if used. Generation itself needs no live external prerequisite.


## Implementation sources

- [packages/@zeruxjs/feed/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/feed/README.md)
- [packages/@zeruxjs/feed/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/feed/package.json)
- [packages/@zeruxjs/feed/src/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/feed/src/types.ts)
- [packages/@zeruxjs/feed/examples/publication.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/feed/examples/publication.ts)
