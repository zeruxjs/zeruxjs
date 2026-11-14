---
{
  "title": "RSS, Atom and JSON feeds",
  "description": "Publish public content with negotiated representations and cache validators.",
  "section": "Packages",
  "order": 16,
  "sources": [
    "packages/@zeruxjs/feed/README.md",
    "packages/@zeruxjs/feed/package.json",
    "packages/@zeruxjs/feed/src/types.ts",
    "packages/@zeruxjs/feed/src/utils.ts",
    "packages/@zeruxjs/feed/src/http.ts",
    "packages/@zeruxjs/feed/src/fetch.ts",
    "packages/@zeruxjs/feed/examples/publication.ts"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/feed"
}
---

## Model the publication

```ts
import { createRssFeed } from '@zeruxjs/feed';
const xml = createRssFeed({ title: 'Updates', description: 'Product news',
  siteUrl: 'https://example.com', feedUrl: 'https://example.com/feed.xml',
  items: [{ id: 'release-1', title: 'First release',
    url: 'https://example.com/releases/1', date: '2025-01-02' }] });
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

There is no automatic `feed` startup service in `zerux.config.js` for this package. Import its public APIs in the owning Node application and retain any Fetch handler for awaited close. There is no browser controller. If a config object holds custom settings, your plugin/application code must explicitly consume them. See [configuration integration boundaries](configuration-reference.md) and [TypeScript](typescript.md).

## A practical integration workflow

Build a feed from published public items with stable IDs, valid HTTP(S) URLs, dates and the correct feed/site origin. Choose RSS, Atom or JSON Feed for the client population; use the Fetch helper when negotiation, HEAD and conditional responses are needed. Supply a changing content function rather than a stale array when publication can change.

## TypeScript: inputs, results and ownership

```ts
import { createRssFeed } from '@zeruxjs/feed';

type Inputs = Parameters<typeof createRssFeed>;
type Result = Awaited<ReturnType<typeof createRssFeed>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createRssFeed>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](typescript.md) for the complete NodeNext checker configuration.

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

| Field         | Accepted type/value                              | Optional |
| ------------- | ------------------------------------------------ | -------- |
| `title`       | `string`                                         | No       |
| `description` | `string`                                         | No       |
| `siteUrl`     | `string`                                         | No       |
| `feedUrl`     | `string`                                         | Yes      |
| `id`          | Authored feed identity, at most 2048 units       | Yes      |
| `authors`     | `FeedAuthor[]`, at most 32                       | Yes      |
| `tags`        | `string[]`, at most 100                          | Yes      |
| `categories`  | `FeedCategory[]`, at most 100                    | Yes      |
| `strict`      | Atom author/IRI/date checks; default false       | Yes      |
| `maxItems`    | Integer 1–10000; direct-generator default 10000  | Yes      |
| `maxBytes`    | UTF-8 output bytes 256–67108864; default 8388608 | Yes      |
| `language`    | `string`                                         | Yes      |
| `copyright`   | `string`                                         | Yes      |
| `image`       | `string`                                         | Yes      |
| `updated`     | `string\|Date`                                   | Yes      |
| `items`       | `FeedItem[]`                                     | No       |

### FeedItem

| Field         | Accepted type/value                             | Optional |
| ------------- | ----------------------------------------------- | -------- |
| `id`          | `string`                                        | No       |
| `atomId`      | Separate authored Atom identity                 | Yes      |
| `contentText` | Plain text, at most 1048576 units               | Yes      |
| `authors`     | `FeedAuthor[]`, at most 32                      | Yes      |
| `categories`  | `FeedCategory[]`, at most 100                   | Yes      |
| `attachments` | `FeedAttachment[]`, at most 16; RSS at most one | Yes      |
| `language`    | Canonicalized BCP 47 tag, at most 64 units      | Yes      |
| `title`       | `string`                                        | No       |
| `url`         | `string`                                        | No       |
| `description` | `string`                                        | Yes      |
| `contentHtml` | `string`                                        | Yes      |
| `date`        | `Date \| string`                                | Yes      |
| `updated`     | `Date \| string`                                | Yes      |
| `author`      | `string`                                        | Yes      |
| `tags`        | `string[]`                                      | Yes      |
| `image`       | `string`                                        | Yes      |
| `enclosure`   | `{url:string;type:string;length:number}`        | Yes      |

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

## Source and cleanup ownership

The Node-oriented root validates/serializes public content with explicit UTF-16 string and UTF-8 byte budgets. Selection helpers may borrow existing records; `normalizeFeed` produces a detached mutable candidate. Encoding XML delimiters is separate from Unicode validation and HTML sanitization. Raw JSON must not be inserted into an HTML script block. Host objects/producers are trusted code, not a sandbox boundary.

The low-level `createFeedResponse` always returns public cache headers. Only the explicit `/fetch` owner performs negotiation, validators, defensive credential-bearing no-store responses and cooperative producer cancellation. Its timer cannot preempt synchronous serialization; timed-out work retains capacity until it actually settles. Await close without expecting it to close borrowed databases or sockets. The [public-import example](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/feed/examples/publication.ts) uses stable authored dates and owns no remote downloads.

### FeedAuthor

| Field    | Accepted type/value                  | Optional |
| -------- | ------------------------------------ | -------- |
| `name`   | `string`, at most 512 UTF-16 units   | No       |
| `url`    | Absolute credential-free HTTP(S) URL | Yes      |
| `email`  | Validated mailbox, at most 254 units | Yes      |
| `avatar` | HTTP(S) URL, JSON Feed only          | Yes      |

### FeedCategory

| Field    | Accepted type/value                    | Optional |
| -------- | -------------------------------------- | -------- |
| `term`   | `string`, at most 512 units            | No       |
| `scheme` | HTTP(S) taxonomy URL                   | Yes      |
| `label`  | `string`, at most 512 units; Atom only | Yes      |

### FeedAttachment

| Field      | Accepted type/value                         | Optional |
| ---------- | ------------------------------------------- | -------- |
| `url`      | Absolute credential-free HTTP(S) URL        | No       |
| `type`     | Bare MIME type/subtype, at most 128 units   | No       |
| `length`   | Safe nonnegative integer bytes              | No       |
| `title`    | `string`, at most 512 units                 | Yes      |
| `duration` | Finite seconds, 0–315360000; JSON Feed only | Yes      |

### FeedFetchOptions

| Field          | Accepted type/value                                                                           | Optional |
| -------------- | --------------------------------------------------------------------------------------------- | -------- |
| `feed`         | `FeedOptions` or trusted `(context: {signal: AbortSignal}) => FeedOptions` / Promise producer | No       |
| `format`       | `rss`, `atom`, `json`, `negotiate`; default `rss`                                             | Yes      |
| `cacheSeconds` | Integer 0–31536000 seconds; default 300                                                       | Yes      |
| `maxItems`     | Selected prefix 1–10000; default 1000                                                         | Yes      |
| `maxBytes`     | Returned UTF-8 bytes 256–67108864; default 8388608                                            | Yes      |
| `timeoutMs`    | Cooperative observation 1–60000ms; default 5000                                               | Yes      |
| `maxPending`   | Actual unsettled jobs 1–128 per handler; default 8                                            | Yes      |

The handler also exposes `status()` with immutable `closed`/`pending` counters and an idempotent awaited `close()`. These are process-local lifecycle facts, not distributed coordination, durable storage or reader interoperability guarantees.
