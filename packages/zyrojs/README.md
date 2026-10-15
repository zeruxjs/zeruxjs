> [!WARNING]
> This package is in a very early stage of development and is only published for pre-saving the name from being taken by somebody else. All current versions follow the `0.0.1-alpha.x` pattern.

# ZyroJS Library

**ZyroJS** is a modern, high-performance Node.js library designed to be the core building block for scalable web applications. It serves as the primary rendering engine for the ZeruxJS ecosystem.

## 🧬 The Hybrid Approach

ZyroJS brings together the best features from established frameworks into a single, unified developer experience:
- **React-like Logic**: Familiar component structures and hook-based state management.
- **Vue-inspired Templates**: Clean, intuitive template syntax that stays close to HTML.
- **Signals & Globals**: Native support for fine-grained reactivity and shared global state.

## ✨ Core Features

| Feature | Description |
| :--- | :--- |
| **State & Hooks** | Intuitive state management with hooks and WordPress-style actions/filters. |
| **Routing** | Built-in system supporting nested views, dynamic parameters, and SSR. |
| **Forms & Validation** | Declarative validators (required, email, etc.) directly in tags. |
| **Optimized Rendering** | Blazing fast performance with SSR support and intelligent asset management. |
| **I18n & Animations** | Native internationalization and built-in animation primitives. |

## 🔗 Ecosystem Integration

ZyroJS is designed to work seamlessly within the **ZeruxJS Framework**, powering everything from simple sites to complex CMS installations like **Zenix**.

## Network protocols, SSE and reactive remote data

Use the optional framework-neutral `zyrojs/network` entry (also re-exported at the root). No React or Vue dependency is required.

```ts
import { createProtocolClient, createQueryCache, createRemoteResource, createEventChannel } from 'zyrojs/network';

const client = createProtocolClient({ baseUrl: 'https://app.example', credentials: 'same-origin', timeoutMs: 10000 });
const answer = await client.rpc<number>('math.add', { a: 5, b: 7 });
const tools = await client.mcp('tools/list');
const response = await client.connect('Messages', 'Ping', { hello: 'world' });
const tdata = await client.trpc('users.find', { id: '123' });

const cache = createQueryCache({ maxEntries: 100, defaultTtlMs: 30000 });
const state = createRemoteResource(signal => client.rpc('users.list', {}, { signal }), { cache, key: 'users:list' });
await state.refresh();
console.log(state.data.value, state.loading.value);
state.dispose(); // abort subscriptions/request on component unmount

const events = createEventChannel('https://app.example/events', { maxReconnects: 3 });
void events.start(); // explicitly start in the browser; SSR-safe by default
// events.latest.value updates as messages arrive
// events.stop() when the view is unmounted
```

`readEventStream` supports credentials, authorization headers, `Last-Event-ID`, explicit AbortSignals and bounded UTF-8 parsing. `connectJsonStream` handles Connect JSON framing with incremental streaming decoding, but does not implement Protobuf or full duplex in all browsers. QueryCache is an **in-memory, per-instance** TTL/LRU cache; it never persists secrets, automatically caches a request, or retries mutating calls. Use explicit cache keys, TTLs and invalidation.

## Search and feed client (Section 39)

```ts
import { createDiscoveryClient } from 'zyrojs/network';
const client = createDiscoveryClient({ baseUrl: 'https://example.com' });
const result = await client.search('search terms', { limit: 20, prefix: true });
const feedXml = await client.feed('rss'); // ETag revalidation
const resource = client.searchResource('posts');
await resource.refresh();
resource.dispose();
client.dispose();
```

Browser/SSR-safe, explicit Fetch dependency injection, bounded downloads, abortable requests and timeout, origin-relative paths, ETag revalidation per feed representation, and reactive search resources. It intentionally omits credentials and does not parse XML into a DOM.
