# zlocale

Explicit, bounded internationalization and localization for JavaScript, Node.js, ZeruxJS and ZyroJS. Version 0.0.4 provides WordPress-style gettext calls, CLDR plural categories, native Intl formatting, immutable catalogs, bounded caches, optional catalog loaders, request-local server translators and a dependency-free Zyro signal adapter. Core/browser imports have no runtime dependencies. Optional build and encoding entries require explicit peers.

## Loading design

Importing the package never reads files, fetches catalogs, starts workers, or initializes an application. Translation and formatting calls are synchronous and perform no filesystem or network I/O. Build catalogs into application modules and split them by locale and domain. Preload the server's active locale/domain set once during application startup. Browser applications import only their selected locale chunks before switching locale. Keep a small supported-locale allowlist; do not load filenames or URLs derived from request input. Server cold locales should be warmed by deployment/background work, not implicitly fetched by translation calls.

The catalog registry defaults to 64 locale/domain catalogs. A catalog defaults to at most 20,000 messages, 16,384 characters per key/value and a 4 MiB UTF-8 key/value text budget. Formatter caches are bounded. Raising limits is an explicit application memory decision. Registering a batch validates everything before changing the registry. Catalogs are defensively copied and frozen; callers cannot mutate installed translations.

## Browser, Node and bundled use

```ts
import { createI18n, defineCatalog, sprintf } from "zlocale";

const fr = defineCatalog({
  locale: "fr",
  domain: "shop",
  messages: {
    Hello: "Bonjour",
    "button\u0004Open": "Ouvrir",
    "%d item": { one: "%d article", other: "%d articles" },
  },
});
const i18n = createI18n({ locale: "fr", domain: "shop", catalogs: [fr] });
i18n.__("Hello"); // Bonjour
i18n._x("Open", "button"); // Ouvrir
sprintf(i18n._n("%d item", "%d items", 3), 3); // 3 articles
i18n.formatNumber(1234.5, { style: "currency", currency: "EUR" });
i18n.formatDateTime(0, { dateStyle: "medium" }); // UTC by default
```

The APIs `__`, `_x`, `_n`, `_nx`, `hasTranslation`, `isRTL` and `subscribe` follow familiar gettext concepts. Context keys use `context + "\u0004" + singular`. Plural records use CLDR categories `zero`, `one`, `two`, `few`, `many`, `other`, with `other` required. Counts must be finite numbers. Missing messages fall back to source text (singular only when count equals 1), and locale lookup follows requested locale → parent locales → configured fallbacks. Domains never leak into one another. Strings remain plain text: escape for the output context, or let Zyro DOM text nodes escape them. `escapeHtml` remains a legacy HTML character encoder. Prefer the explicit destination encoders in `zlocale/encoding` (optional `@zeruxjs/security` peer): `escapeHtmlText`, `escapeHtmlAttribute`, `serializeJsonForScript` and `validateNavigationUrl`. Validate URLs before attribute encoding. None sanitizes arbitrary HTML, event handlers or CSS.

`interpolate('Hello %{name}', {name:'Ada'})` supports named string/finite-number values. `sprintf` supports `%%`, `%s`, `%d`, `%f`, positional arguments such as `%2$s` and precision such as `%.2f`; it is deliberately not the complete PHP printf grammar. Missing/unsupported placeholders fail explicitly. No eval, Function constructor, raw HTML injection or executable plural expressions.

Native Intl output depends on the host's ICU/CLDR version. Provide a timezone explicitly when UTC is unsuitable; use the same timezone/locale/catalogs on server and client. The package does not include ICU MessageFormat, PO/MO parsing, WordPress hooks, ICU message evaluation or a general framework renderer. WordPress-style function names do not imply WordPress wire-format compatibility.

## Optional loading

```ts
import { createCatalogLoader } from "zlocale";
const loader = createCatalogLoader({
  "fr/shop": () => import("./locales/fr-shop.js").then((m) => m.default),
  "ar/shop": () => import("./locales/ar-shop.js").then((m) => m.default),
});
// Startup, build step, route prefetch or a user-initiated locale change:
const catalogs = await loader.preload(["fr/shop"]);
i18n.registerCatalogs(catalogs);
i18n.setLocale("fr");
```

Only declared manifest keys can load. Concurrent loads of the same key share a promise; successful results are retained in an LRU cache and failed loads can retry. Both cache and in-flight count are bounded. Preloading uses bounded concurrency. `load(key, { signal })` and `preload(keys, { signal })` detach a cancelled caller; other waiters remain active. Loaders receive `{ signal }` and must cooperate with abort. Defaults: 32 cached entries, 16 pending jobs, preload concurrency 4, 16 MiB serialized UTF-8 cache bytes and a 30-second producer deadline (maximum 300 seconds). A catalog larger than the entire cache budget rejects. Eviction is LRU. `invalidate(key)` after a source change, or `clear()` for all keys, evicts data and aborts stale pending work; stale completions cannot repopulate the cache. A cancelled job retains its pending slot until actual settlement, and another call to that key rejects until it drains. `await close()` aborts and drains actual work and rejects later calls; it never closes borrowed transports. Noncooperative loaders can delay close indefinitely. `getStatus()` exposes path/value-free counts. Failed loads can retry after settlement. Loader functions must return catalog data, not executable translator functions. No loader is called by `__` or formatting methods. Browser/server entry points share the same catalog format.

## ZeruxJS / Node request isolation

```ts
import { createI18n } from "zlocale";
import { createRequestI18n } from "zlocale/node";
const i18n = createI18n({ locale: "en", catalogs: applicationCatalogs });
const requestI18n = createRequestI18n(i18n);

// Inside your host middleware, choose a validated supported locale.
await requestI18n.run("fr", async () => {
  const t = requestI18n.current();
  return { message: t.__("Hello"), total: t.formatNumber(1234) };
});
```

Call `run` around the host's actual downstream handler. Async work inside it retains the translator, including concurrent requests. `current()` outside a run throws; there is no implicit process-wide request locale. Call `requestI18n.dispose()` after finishing active requests during host teardown. Never call the mutable browser-style `setLocale` on a shared server instance per request. `forLocale` returns a locale-fixed view over the shared immutable catalog registry. Changing the owning instance's locale does not affect an existing request view. Plugins may preload application catalogs at startup; this release does not automatically add a `zerux.config.js` property or bootstrap services. Explicit integration keeps application startup under your control.

## ZyroJS

```ts
import { signal, h, render } from "zyrojs";
import { createI18n } from "zlocale";
import { createZyroI18n } from "zlocale/zyro";
const i18n = createI18n({ locale: "en", catalogs: applicationCatalogs });
const lang = createZyroI18n(i18n, signal);
render(
  h("p", {}, () => lang.__("Hello")),
  document.querySelector("#app")!,
);
i18n.setLocale("fr"); // reactive text updates
// On application teardown:
lang.dispose();
```

The adapter accepts a signal factory rather than importing ZyroJS. It works in browser bundles and Node SSR; the package does not include DOM APIs or a second Zyro runtime. Scope each instance to its application/mount. `dispose` unsubscribes and rejects later adapter reads. Generic frameworks can use `subscribe`, `getLocale` and locale-fixed translators directly. Subscribers observe locale/catalog changes; the host controls rendering and document `lang`/`dir` attributes.

## Async locale switching (0.0.4)

```ts
import { createLocaleController } from "zlocale";
const controller = createLocaleController(i18n, loader, {
  supportedLocales: ["en", "fr", "ar"],
  domains: ["shop"],
});
const applied: boolean = await controller.switchLocale("fr");
// true: catalogs installed and locale switched; false: superseded/cancelled/disposed.
controller.cancel(); // cancels this selection; other loader waiters remain independent
controller.dispose(); // call during host teardown
```

All required locale/domain catalogs load and validate before installation. The current locale remains active while loading. If a user chooses French then Arabic, a late French response cannot overwrite the Arabic selection. Obsolete failures resolve `false`; the latest selection's failure rejects and keeps the previous locale. Unsupported selections reject before loading and do not cancel a valid pending selection. Catalog keys use the selected locale's base name (excluding Unicode extensions). This API requires explicit catalogs for that base locale; it does not implicitly load parent/fallback catalogs. Preload those separately when needed. Defaults: the `default` domain; at most 128 supported locales and 32 domains. The controller forwards cancellation on replacement, cancel and dispose; legacy loaders accepting only keys still work but cannot cooperate. The host retains ownership of loaders, translator and DOM `lang`/`dir` updates. Set `lang` from `getLocale()` and `dir` to `isRTL() ? "rtl" : "ltr"` on the mount/document after an applied switch; request-fixed translators supply the same values for SSR. Subscribers still observe catalog registration and locale changes separately. A subscriber failure can occur after a registry commit, as with direct `registerCatalogs`; do not throw from UI subscribers. Use request-fixed translators on shared servers instead of this mutable application controller.

## SSR catalog hydration (0.0.2)

Serialize only the public catalogs the page needs; never include private user data. The versioned payload escapes `<`, `>`, `&` and Unicode line separators so translations cannot close an HTML JSON data block. This is JSON data, not a JavaScript program or an HTML attribute value.

```ts
import { serializeCatalogs, parseCatalogs } from "zlocale";
// Server: put this exact string inside a <script type="application/json"> data block.
const payload = serializeCatalogs(publicPageCatalogs);
// Browser: read that block's textContent; do not use innerHTML or eval.
const snapshot = parseCatalogs(payload);
i18n.registerCatalogs(snapshot.catalogs);
```

Both directions validate and copy catalogs, reject duplicate locale/domain pairs, and return or consume a versioned envelope. Defaults: 64 catalogs, 8 MiB UTF-8 serialized payload, plus the existing per-catalog limits. Configure `maxCatalogs`, `maxBytes`, and `limits` explicitly when needed. Parsing enforces the wire size before JSON parsing; catalog validation remains synchronous and bounded. Empty snapshots are valid. Locale/timezone selection remains explicit and must match the server render. The API does not choose catalogs or change the active locale automatically.

## Incremental catalogs and build extraction

A minimal browser-safe example using public imports (each app/request owns its locale):

```ts
import { createI18n, createCatalogLoader } from "zlocale/browser";

const loader = createCatalogLoader({
  "fr/shop": async ({ signal }) => {
    signal.throwIfAborted();
    return { locale: "fr", domain: "shop", messages: { Hello: "Bonjour" } };
  },
});
try {
  const catalogs = await loader.preload(["fr/shop"]);
  const t = createI18n({ locale: "fr", domain: "shop", catalogs });
  console.log(t.__("Hello"), t.getLocale(), t.isRTL() ? "rtl" : "ltr");
} finally {
  await loader.close();
}
```

Build-only extraction requires an explicitly installed TypeScript 5.9 peer (`>=5.9.3 <6`); it parses source text with the compiler API and never imports/evaluates source modules:

```ts
import { createSourceExtractor, compressCatalogs } from "zlocale/build";

const extractor = createSourceExtractor({ receivers: ["t"], defaultDomain: "shop" });
const result = extractor.extract("page.ts", 't._nx("%d item", "%d items", count, "cart", "shop")');
if (result.diagnostics.length) throw new Error("Fix extraction diagnostics before building catalogs");
// Send result.messages to the host translation workflow; this API does not invent translations.
extractor.invalidate("page.ts"); // watcher removal; modified content invalidates automatically
extractor.clear(); // build owner teardown
const gzipBytes = await compressCatalogs([
  { locale: "fr", domain: "shop", messages: { Hello: "Bonjour" } },
]);
// Write gzipBytes during your build; serve with Content-Encoding: gzip.
```

Supported calls are `__`, `_x`, `_n`, `_nx`, with exact gettext argument positions. Direct identifier calls are recognized by convention; member calls require an explicitly approved identifier receiver. Aliases require `functions: { tr: "__" }`. Extraction is syntactic, without symbol resolution: shadowed names may match, and undeclared aliases/wrappers are outside this grammar. JS/TS/JSX/TSX (including .mjs/.cjs/.mts/.cts) are supported; templates/SFCs and computed/nested receivers are not compiled. Static string literals and no-substitution templates supply singular/plural/context/domain metadata plus one-based locations; dynamic counts are allowed. Dynamic keys/domains/templates report `DYNAMIC_KEY`, unsupported recognized calls report `INVALID_CALL`, malformed files report `SYNTAX` and yield no messages. Diagnostics contain locations/codes, not source snippets. Hosts must fail catalog generation on diagnostics. Results retain occurrence order, not deduplicated catalog keys; the host must resolve conflicting plural definitions before catalog publication.

Defaults per source: 1 MiB UTF-8, 20,000 messages/diagnostics, 200,000 AST nodes. Incremental caches retain at most 128 files and 8 MiB of serialized results; source text itself is not retained. Explicit bounds can be lowered; resource exhaustion throws. No watcher starts on import. Wire extraction into the host's existing source-change notifications and catalog loader `invalidate(localeDomainKey)` when publishing a revised catalog. Installed translator registries are immutable snapshots and update only through explicit `registerCatalogs(..., { replace: true })`; cache invalidation alone does not change an active request's catalog generation.

Catalog validation now requires supported `%{name}` and printf argument identities/types to match the source in every translated plural form. Positional reordering and precision changes are allowed; missing/added placeholders and numeric/string type changes reject before registry mutation. Context is excluded from placeholder comparison. This intentionally tightens acceptance of previously malformed catalogs; fix those translations rather than disabling validation. Literal percent text is not an ICU expression. `interpolate` and `sprintf` remain explicit, bounded plain-text formatters; native Intl number/date/list/relative-time methods validate runtime argument shapes and let Intl reject invalid native enum/range options. Unknown Intl option names follow native behavior; there is no ICU MessageFormat parser or evaluation.

Fallback order is requested base locale, successively less-specific parents, then each configured fallback and its parents, deduplicated in order, then source text. Domains never fall back into another domain. Missing plural source uses `count === 1` for singular; installed plural forms use the matched catalog locale's native cardinal rules and its `other` form. Direction comes from the selected locale, independently of which fallback supplied text. Catalogs contain public translation data only, never tenant secrets. No per-request synchronous compression occurs: only the explicit build entry provides asynchronous gzip over the bounded V1 snapshot; runtime loading still expects decoded catalog objects. Transport decompression limits remain the host's responsibility.

Optional peers are inert: importing core does not require TypeScript or security. Missing peers produce an ordinary module-not-found error only on the corresponding `/build` or `/encoding` import. No lint adapter or automatic framework registration is added.

## Operations and qualification

Run `npm run build` from this directory. Export `zlocale`, its explicit `zlocale/browser` alias and `zlocale/zyro` to browser bundles; `zlocale/node` imports Node async hooks; `zlocale/build` separately imports Node build tools and the optional TypeScript parser. Neither is in the core/browser graph. ESM imports and modern Node require(esm) are supported by the emitted ESM package; legacy CommonJS runtimes need dynamic import. Node 20+ and browsers with native Intl APIs are required. No browserslist polyfills or timezone databases are bundled.

Do not share private user-specific translations in a process-wide catalog. Translation text is data, never HTML or a template to execute. Catalog input must be plain JSON-shaped objects with own data properties; accessors/prototype tricks are rejected. Locale/catalog limits do not constrain arbitrary work performed by application-provided loader functions. This 0.x release requires host integration testing before production adoption; local tests do not certify every browser, ICU version or language.

## Design references

- WordPress gettext concepts: https://developer.wordpress.org/block-editor/reference-guides/packages/packages-i18n/
- Node request-local state: https://nodejs.org/api/async_context.html#class-asynclocalstorage
- Native Intl behavior: https://tc39.es/ecma402/
- TypeScript compiler API: https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API

## License

MIT OR Apache-2.0. No WordPress source is copied and no WordPress runtime dependency is required.

## Catalog generations and lifetime details

A locale-fixed translator captures its language/fallback chain, while reading the
owner's current immutable catalog registry. Replacing/removing catalogs explicitly
can therefore affect later reads through an existing fixed view. Loader invalidation
alone does not install a new registry generation. If a request must pin an entire
catalog generation across a rollout, the host must supply a separate preloaded
catalog owner rather than mutate a shared registry mid-request.

`createCatalogLoader` owns producer signals, deadlines, waiter listeners and bounded
cache references. Controllers own only their locale-selection waiter; request
facades own their AsyncLocalStorage, and reactive adapters own their subscription.
Dispose these owners separately. `createI18n` has no invented destroy/close method;
release subscriber registrations through their returned unsubscribe functions.
`createSourceExtractor` retains bounded result metadata until invalidate/clear or
owner release, starts no watcher and never executes source to discover strings.

Catalog updates commit before synchronous subscriber notifications. A subscriber
failure does not roll back the registry or a locale change. Keep subscribers
nonthrowing and do not replay a mutation merely because notification failed.
Extraction diagnostics contain codes/locations, but other runtime exceptions may
include developer-selected placeholder names; hosts should select/redact diagnostics
instead of exposing arbitrary errors to clients. Text remains inert and destination
escaping does not grant permission to publish tenant-private catalogs.
