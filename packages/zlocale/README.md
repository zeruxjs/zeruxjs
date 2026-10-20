# zlocale

Explicit, bounded internationalization and localization for JavaScript, Node.js, ZeruxJS and ZyroJS. Version 0.0.2 provides WordPress-style gettext calls, CLDR plural categories, native Intl formatting, immutable catalogs, bounded caches, optional catalog loaders, request-local server translators and a dependency-free Zyro signal adapter. No runtime dependencies.

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

The APIs `__`, `_x`, `_n`, `_nx`, `hasTranslation`, `isRTL` and `subscribe` follow familiar gettext concepts. Context keys use `context + "\u0004" + singular`. Plural records use CLDR categories `zero`, `one`, `two`, `few`, `many`, `other`, with `other` required. Counts must be finite numbers. Missing messages fall back to source text (singular only when count equals 1), and locale lookup follows requested locale → parent locales → configured fallbacks. Domains never leak into one another. Strings remain plain text: escape for the output context, or let Zyro DOM text nodes escape them. `escapeHtml` is available for server HTML text/quoted attributes. It does not sanitize URLs or arbitrary HTML.

`interpolate('Hello %{name}', {name:'Ada'})` supports named string/finite-number values. `sprintf` supports `%%`, `%s`, `%d`, `%f`, positional arguments such as `%2$s` and precision such as `%.2f`; it is deliberately not the complete PHP printf grammar. Missing/unsupported placeholders fail explicitly. No eval, Function constructor, raw HTML injection or executable plural expressions.

Native Intl output depends on the host's ICU/CLDR version. Provide a timezone explicitly when UTC is unsuitable; use the same timezone/locale/catalogs on server and client. The package does not include ICU MessageFormat, PO/MO parsing, WordPress hooks, automatic string extraction or a general framework renderer. WordPress-style function names do not imply WordPress wire-format compatibility.

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

Only declared manifest keys can load. Concurrent loads of the same key share a promise; successful results are retained in an LRU cache and failed loads can retry. Both cache and in-flight count are bounded. Preloading uses bounded concurrency. `clear()` clears fulfilled cache entries; it does not cancel application loaders. Loader functions own their network cancellation/timeouts and must return catalog data, not executable translator functions. No loader is called by `__` or formatting methods. Browser/server entry points share the same catalog format.

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

## Operations and qualification

Run `npm run build` from this directory. Export `zlocale` and `zlocale/zyro` to browser bundles; `zlocale/node` alone imports Node async hooks. ESM imports and modern Node require(esm) are supported by the emitted ESM package; legacy CommonJS runtimes need dynamic import. Node 20+ and browsers with native Intl APIs are required. No browserslist polyfills or timezone databases are bundled.

Do not share private user-specific translations in a process-wide catalog. Translation text is data, never HTML or a template to execute. Catalog input must be plain JSON-shaped objects with own data properties; accessors/prototype tricks are rejected. Locale/catalog limits do not constrain arbitrary work performed by application-provided loader functions. This 0.x release requires host integration testing before production adoption; local tests do not certify every browser, ICU version or language.

## Design references

- WordPress gettext concepts: https://developer.wordpress.org/block-editor/reference-guides/packages/packages-i18n/
- Node request-local state: https://nodejs.org/api/async_context.html#class-asynclocalstorage
- Native plural categories: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules

## License

MIT OR Apache-2.0. No WordPress source is copied and no WordPress runtime dependency is required.
