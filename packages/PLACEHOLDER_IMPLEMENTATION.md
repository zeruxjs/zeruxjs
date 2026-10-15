# Formerly empty package entry points

This pass replaces the empty `src/index.ts` files in 15 @zeruxjs packages and the `zeyro` testing entry point with initial working APIs. All APIs are provisional and remain at alpha package version.

| Package | Implemented entry-point functionality |
| --- | --- |
| `@zeruxjs/media` | Disk media storage, bounded uploads, UUID IDs, metadata, expiry, SHA-256 verification, download and deletion |
| `@zeruxjs/asset-manager` | Asset registry, filtering, import/export, immutable copies |
| `@zeruxjs/feed` | RSS 2.0, Atom and JSON Feed writers |
| `@zeruxjs/share` | Native Web Share, clipboard and social sharing links |
| `@zeruxjs/ai-model` | Local document keyword search and retrieval context (not a trained model) |
| `@zeruxjs/search` | Incremental inverted-index token search |
| `@zeruxjs/seo` | HTML metadata, XML sitemap and robots.txt helpers |
| `@zeruxjs/font` | Font-face CSS and preload/style helpers |
| `@zeruxjs/accessibility` | Visually-hidden style, focus trap, ARIA announcements, reduced motion |
| `@zeruxjs/vue` | Framework-neutral Vue-ref-style bridge |
| `@zeruxjs/react` | React useSyncExternalStore-compatible store |
| `@zeruxjs/ai` | Provider abstraction and OpenAI-compatible HTTP chat client |
| `@zeruxjs/mcp` | Local tool registry (not network MCP protocol transport) |
| `@zeruxjs/zyro` | Framework-neutral observable and selectors |
| `@zeruxjs/performance` | PerformanceObserver helper, navigation timings, caching and resource hints |
| `zeyro` | Test registration, suites, assertion and asynchronous test runner |

## Usage

```ts
import { SearchIndex } from '@zeruxjs/search';
const index = new SearchIndex();
index.add({id:'intro', text:'Hello from ZeruxJS'});
console.log(index.search('hello'));
```

```ts
import { createRssFeed } from '@zeruxjs/feed';
const rss = createRssFeed({ title:'My feed', description:'Updates', siteUrl:'https://example.com', items:[{id:'post-1',title:'First post',url:'https://example.com/first'}] });
```

```ts
import { MediaStore } from '@zeruxjs/media';
const store = new MediaStore('./private-media');
const metadata = await store.upload(new TextEncoder().encode('example'), {name:'sample.txt',contentType:'text/plain'});
const {data} = await store.download(metadata.id);
```

## Scope and limits

These are *initial implementations*, not complete feature parity with established production services. In particular, media writes do not implement distributed storage or antivirus scanning; search does not implement linguistic stemming or persistent indexes; AI model is retrieval only and has no trained LLM; MCP only supports in-process tools and not the complete MCP transport/protocol; framework adapters have not been tested against live React or Vue runtimes. The pre-existing blank submodules of `zeyro` still need implementations. Full dependency integration, E2E testing, cross-platform and security review are required before production release.

> **Section 31 migration note:** `@zeruxjs/mcp` has been retired; its tool/resource
> APIs now live in `zsrv/src/protocols/mcp` and are exported from `zsrv`.
