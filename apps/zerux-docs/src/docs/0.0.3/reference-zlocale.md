---
{
  "title": "Internationalization and localization",
  "description": "Use zlocale for bounded in-memory translation, native locale formatting, request isolation and reactive Zyro text.",
  "section": "Packages",
  "order": 215,
  "package": "zlocale",
  "sources": [
    "packages/zlocale/README.md",
    "packages/zlocale/package.json",
    "packages/zlocale/src/core.ts",
    "packages/zlocale/src/node.ts",
    "packages/zlocale/src/zyro.ts",
    "packages/zlocale/src/loader.ts",
    "packages/zlocale/src/snapshot.ts",
    "packages/zlocale/src/controller.ts"
  ],
  "related": [
    "packages",
    "typescript",
    "middleware",
    "request-lifecycle"
  ]
}
---

## Install and choose the execution boundary

```sh
npm install zlocale@0.0.3
```

`zlocale` is a browser-safe, framework-independent i18n/l10n core. `zlocale/node` adds Node request-local state. `zlocale/zyro` adapts translation reads to the host's signal implementation. There are no runtime dependencies and no application or service is started on import. It can run in a browser bundle, a Node server, SSR or a background process.

Internationalization is the application/API structure that makes translation possible. Localization is the actual translated text and locale-sensitive display of dates, numbers, lists and relative time. Both may run on the server or browser; the import boundary determines whether Node-only functionality is included.

This release offers WordPress-style calls; it does not claim complete WordPress runtime or PO/MO/Jed compatibility. Catalogs use native CLDR plural categories rather than executable gettext plural expressions.

## Catalogs and synchronous translation

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
const i18n = createI18n({ locale: "fr-CA", domain: "shop", catalogs: [fr] });
const greeting: string = i18n.__("Hello");
const action: string = i18n._x("Open", "button");
const quantity: string = sprintf(i18n._n("%d item", "%d items", 3), 3);
```

`__` translates plain text. `_x` adds a translator context. `_n` selects a plural category using the catalog locale. `_nx` combines plural selection and context. Context is encoded in catalog keys using U+0004. Plural records require `other`; supported categories are zero, one, two, few, many and other. Arabic and Russian are not reduced to an English singular/plural rule.

Lookup tries the requested locale, its base/parent locales, then configured fallbacks. Each domain stays isolated. Missing translations return source text; missing plurals use singular when count is exactly 1 and plural otherwise. `hasTranslation` distinguishes a missing entry from an intentional empty translation. `isRTL()` determines text direction from native locale data with a script fallback.

Catalogs are defensively copied and frozen. Registry updates validate a complete batch before committing. Duplicate catalogs require `registerCatalogs(catalogs, {replace:true})`; `removeCatalog` releases a registry entry. `getCatalog` returns immutable data. `subscribe` returns an idempotent disposer. A committed update notifies all subscribers; callback failures propagate as an AggregateError and recursive updates are bounded.

## Loading without per-request disk access

Use a build-time allowlist of imports. Avoid constructing paths from a request header, cookie or URL.

```ts
import { createCatalogLoader } from "zlocale";
const loader = createCatalogLoader({
  "fr/shop": () =>
    import("./locales/fr-shop.js").then((module) => module.default),
  "ar/shop": () =>
    import("./locales/ar-shop.js").then((module) => module.default),
});
// At application startup, before accepting requests:
const catalogs = await loader.preload(["fr/shop"]);
i18n.registerCatalogs(catalogs);
```

A catalog module exports plain catalog data. The same manifest can be bundled into locale/domain chunks for browser applications. Load the selected chunk before changing locale; loading is always an explicit async boundary. `__`, `_n` and formatting never invoke loaders, read files or fetch URLs.

Concurrent loads for one key share a promise. Cache entries, in-flight jobs and preload concurrency are bounded, and failed loads may retry. A loader returning a different locale/domain fails validation. `clear()` drops fulfilled cached results; application loader functions own their timeouts/cancellation and may still be in flight. Preload only hot locales during startup; warm other allowed catalogs using controlled background/deployment work, rather than hiding cold I/O inside a translation call. The host chooses its memory/startup tradeoff.

## ZeruxJS request integration

Create one catalog owner and one request-context facade for the application. Preload catalogs during the owning plugin/application's startup. The middleware must wrap the actual downstream handler.

```ts
import type { ZeruxRequestContext } from "zeruxjs";
import { createI18n } from "zlocale";
import { createRequestI18n } from "zlocale/node";
import { publicCatalogs } from "./locales/index.js";

export const i18n = createI18n({
  locale: "en",
  domain: "shop",
  catalogs: publicCatalogs,
});
export const requestI18n = createRequestI18n(i18n);

export default function localeMiddleware(
  context: ZeruxRequestContext,
  next: () => Promise<void>,
) {
  // This example uses an explicit URL setting; a real app may use a verified preference.
  const requested = context.query.get("lang");
  const locale = requested === "fr" ? "fr" : "en";
  context.res.setHeader("Content-Language", locale);
  return requestI18n.run(locale, next);
}
```

A route or service called inside the middleware can use `requestI18n.current().__('Hello')`. AsyncLocalStorage keeps concurrent request locales separate. `current()` outside `run` throws. The request translator is locale-fixed: another request or a browser-style `setLocale` call cannot change its language. `forLocale(locale)` also provides an explicit fixed view when passing a translator directly is preferable.

Do not call `setLocale` on a shared server instance per request. Do not infer that installing zlocale creates an `i18n` runtime service or a supported root key in `zerux.config.js`; integration is explicit in this release. Call `requestI18n.dispose()` during host teardown after active requests finish. It disables the context; subsequent reads/runs fail. The browser core never imports Node async hooks.

Localized cache entries must include locale in their key. If selection depends on Accept-Language, configure a matching Vary policy; cookie/user-preference responses usually need private caching. Content-Language is a response hint, not a cache partition or authorization boundary. Public shared catalogs must not contain user-private text.

## Browser and ZyroJS localization

```ts
import { signal, h, render } from "zyrojs";
import { createI18n } from "zlocale";
import { createZyroI18n } from "zlocale/zyro";
import { publicCatalogs } from "./locales/index.js";

const i18n = createI18n({
  locale: "en",
  domain: "shop",
  catalogs: publicCatalogs,
});
const lang = createZyroI18n(i18n, signal);
const host = document.querySelector("#app");
if (!host) throw new Error("Missing mount");
render(
  h(
    "section",
    {},
    h("p", {}, () => lang.__("Hello")),
    h("p", {}, () => lang.formatNumber(1234.5)),
  ),
  host,
);
// After explicitly loading/registering the selected locale's catalog:
i18n.setLocale("fr");
// During host teardown, after stopping/unmounting its reactive effects:
lang.dispose();
```

The adapter receives the host's signal factory, so it does not bundle a second Zyro runtime. Function children read the revision signal and update after locale/catalog changes. Other frameworks can subscribe directly. Set document `lang` and `dir` in the owning application; a process/SSR translator does not mutate browser globals. Stop reactive effects before disposing the translator; reads after disposal throw.

The same core works during SSR and in background processes. Use locale-fixed views and identical public catalogs/timezone for deterministic server/client formatting. This is not a hydration engine.

## Locale formatting and output safety

```ts
const cost = i18n.formatNumber(1234.5, { style: "currency", currency: "EUR" });
const day = i18n.formatDateTime(0, { dateStyle: "medium", timeZone: "UTC" });
const relative = i18n.formatRelativeTime(-1, "day", { numeric: "auto" });
const list = i18n.formatList(["Ada", "Lin"]);
```

Native Intl instances are reused in a bounded LRU cache. Date/time formatting defaults to UTC rather than the server's local timezone; override it deliberately for a user's display timezone. Actual text can vary with host ICU/CLDR data. This package does not ship polyfills or a timezone database.

Translations and interpolation return plain strings. Zyro text children escape DOM text. For server-rendered HTML text/quoted attributes, use `escapeHtml`; validate URL contexts separately. Never insert a translated string using innerHTML. `interpolate` accepts named own string/finite-number values. `sprintf` supports strings, integers, floats, positional arguments and precision; it does not implement the complete PHP format grammar. Neither function evaluates code or executes message instructions.

## TypeScript and resource limits

Public `Catalog`, `CatalogLimits`, `Message`, `PluralCategory`, `I18nOptions`, `Translator` and `I18n` types describe the integration. `defineCatalog(unknown)` validates runtime JSON-shaped data and returns an immutable catalog. TypeScript alone is not validation. Own accessors, symbol properties, unsupported plural categories and nonplain objects are rejected.

Defaults are 64 registered catalogs, 20,000 messages per catalog, 16,384 characters per string, a 4 MiB UTF-8 text budget per catalog, and 64 formatter-cache entries. Loader defaults are 32 cached catalogs, 16 in-flight loads and preload concurrency 4. Applications may choose explicit bounded limits. All API instances belong to the host application; no import-time singleton locale is shared across users.

Package qualification covers translation fallback, CLDR plurals, adversarial catalogs, atomic updates, bounded/single-flight loading, concurrent Node contexts, real Zyro signal subscriptions, browser bundling and packed-package consumers. Verify your actual browsers, language catalogs, ICU deployment, response caching and application lifecycle before production adoption.

## SSR hydration and catalog transfer

Version 0.0.2 adds typed `serializeCatalogs(catalogs, options?)` and `parseCatalogs(text, options?)`. Serialize an explicit public locale/domain subset on the server and hydrate it before the first browser render. This avoids refetching catalogs already used for SSR.

```ts
import { serializeCatalogs, parseCatalogs, createI18n } from "zlocale";
const payload = serializeCatalogs(publicPageCatalogs);
// Send payload as the contents of a script[type="application/json"] data block.
// Read the block's textContent on the client; never eval its contents.
const { catalogs } = parseCatalogs(payload);
const clientI18n = createI18n({ locale: "fr", timeZone: "UTC", catalogs });
```

The versioned envelope escapes HTML delimiters and Unicode line separators, rejects duplicate locale/domain pairs and unsupported versions, and returns deeply frozen validated catalogs. Only expose public translations: escaping does not make confidential messages public-safe. Payloads default to at most 64 catalogs and 8 MiB UTF-8; `SnapshotOptions` lets you configure `maxCatalogs`, `maxBytes`, and per-catalog `limits`. HTML escaping here is specifically for a JSON data block, not an attribute, URL or executable script. Match locale, timezone and fallback settings across server and browser to avoid hydration differences.

## Race-safe browser locale selection

Version 0.0.3 provides `createLocaleController` and the TypeScript types `LocaleController`, `LocaleControllerOptions` and `LocaleLoader`. Supply the application-owned `i18n`, its bounded catalog loader, an explicit locale allowlist and required domains.

```ts
import { createLocaleController } from "zlocale";
const controller = createLocaleController(i18n, loader, {
  supportedLocales: ["en", "fr", "ar"],
  domains: ["shop"],
});
const applied: boolean = await controller.switchLocale("fr");
if (applied) {
  document.documentElement.lang = i18n.getLocale();
  document.documentElement.dir = i18n.isRTL() ? "rtl" : "ltr";
}
// Host teardown:
controller.dispose();
```

Rapid selections are last-selection-wins: a slower earlier locale cannot overwrite the latest one. All required catalogs must load, validate and match their requested locale/domain keys before installation. The old locale stays active while loading. A current failure rejects; superseded, cancelled or disposed work resolves `false`. `cancel()` ignores pending results without cancelling shared loader imports. Unsupported locale selections reject before loading. Catalog keys use the selected BCP-47 base name; explicitly preload parent/fallback catalogs if the application needs them. Supported locales are bounded to 128 and domains to 32. Subscriber callbacks should not throw: registration and locale changes notify separately, and a thrown subscriber can follow a committed registry update. This controller changes an application-owned locale, never a shared server request locale; use `zlocale/node` for request isolation.
