# @zeruxjs/feed

Modular RSS 2.0, Atom 1.0, and JSON Feed 1.1 generators.

```ts
import { createRssFeed, createAtomFeed, createJsonFeed, createFeedResponse } from '@zeruxjs/feed';
const config = {
  title: 'Updates', description: 'Product releases', siteUrl: 'https://example.com',
  feedUrl: 'https://example.com/feed.xml',
  items: [{ id: 'release-1', title: 'Version 1', url: 'https://example.com/releases/1', date: '2025-01-02' }],
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

See the runnable [public-import example](examples/publication.ts). Generators
preserve authored item/author/category/attachment order and do not fetch images,
author URLs or enclosure files. The model is deliberately a subset of
[RSS 2.0](https://www.rssboard.org/rss-2-0-11),
[Atom 1.0](https://www.rfc-editor.org/rfc/rfc4287) and
[JSON Feed 1.1](https://www.jsonfeed.org/version/1.1/):

| Field       | RSS                                                                           | Atom                                         | JSON Feed                                        |
| ----------- | ----------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------ |
| Identity    | item.id as opaque guid, isPermaLink=false                                     | feed id or siteUrl; item.atomId or item.id   | item.id string                                   |
| Authors     | repeated Dublin Core creator names; one item email also emits standard author | multiple name/uri/email, feed inheritance    | multiple name/url/avatar, feed/item inheritance  |
| Categories  | feed/item term, optional domain from scheme                                   | feed/item term, scheme, label                | item terms as tags; no feed taxonomy field       |
| Language    | channel language; item dc:language extension                                  | feed/entry xml:lang                          | feed/item language                               |
| Attachments | one enclosure: URL, MIME, byte length                                         | multiple enclosure links plus optional title | multiple attachments plus title/duration seconds |
| Content     | description/plain text, content:encoded HTML extension                        | summary; text or escaped HTML content        | content_text/content_html                        |
| Dates       | pubDate and known-content lastBuildDate                                       | updated/published                            | date_published/date_modified                     |
| Images      | channel image                                                                 | feed logo                                    | feed icon/item image and author avatars          |

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

## Reading the implementation and owning publication

The public root is Node-oriented: `utils.ts` uses Node UTF-8 byte accounting for bounded normalization/output. The `/fetch` entry additionally uses Node cryptographic hashing and native Fetch/Abort APIs. No browser controller or automatic framework service is installed. `types.ts` documents content-owned fields and units; `content-type.ts` selects only declared media types. `rss.ts`, `atom.ts` and `json.ts` serialize the documented subset without downloading references. Generated XML literals intentionally retain their exact whitespace because representation bytes and ETags are observable.

The root `authors`, `attachments` and `categories` helpers select/project values; they are not standalone validators or deep clones. `normalizeFeed` stages a detached candidate, while `validate` discards that candidate after checking it. String limits count UTF-16 code units; byte limits count UTF-8. Direct `escapeXml` encodes delimiters/whitespace and strips selected controls; full Unicode validation belongs to normalization. Neither helper is an HTML sanitizer or a sandbox for application Proxy/coercion code.

`createFeedResponse` always returns public cache headers and does not inspect credentials or negotiate a request. The retained `/fetch` handler supplies conditional responses and defensive private headers for credential-bearing requests, but still has no principal/tenant authorization. Its timer bounds cooperative observation when the event loop runs; synchronous serialization and arbitrary producer JavaScript cannot be preempted. `close()` stops admission, aborts cooperative work and awaits actual producer settlement; it never closes a host database/client or revokes copies readers already cached.
