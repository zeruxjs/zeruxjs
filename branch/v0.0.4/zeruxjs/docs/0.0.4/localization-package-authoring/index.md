# Translate a module or plugin

Ship domain-isolated catalogs and typed translation APIs without loading every locale into the host application.


## Choose the package boundary

A reusable package owns its message identifiers, translator contexts, text domain and catalog files. The application owns the active language, which catalogs enter the browser, request isolation and persistence of user preferences. Keep those responsibilities separate so two modules can run in one site without changing each other's locale or translations.

Use a stable domain such as `acme-cart`, rather than the host's `default` domain. Domain names accept letters, digits, dots, underscores and hyphens, must start with a letter/digit and are bounded to 128 characters. A domain is a translation namespace; it does not isolate untrusted package code or authorize access to user data.

Install `zlocale@0.0.3` for development. A package exposing integration with a host-owned translator can declare a compatible peer dependency and install it as a development dependency for TypeScript. Do not construct a mutable translator singleton when the module is imported. Type-only imports disappear from compiled JavaScript.

## Export messages as typed functions

The example package below is called `@example/cart`; replace that illustrative name with your own published package. Translation reads receive a locale-fixed `Translator` from the host. Passing the translator makes the same function work in a Node worker, request handler, Zyro component or another framework.

```ts title="src/messages.ts"
import { sprintf, type Translator } from 'zlocale';

/** Format cart quantity in a host-selected locale. @param translator Locale-fixed translator. @param count Nonnegative safe-integer quantity. @returns Plain display text. No process/request/DOM globals or I/O. */
export function cartQuantity(translator: Translator, count: number): string {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError('Invalid cart quantity');
  }
  return sprintf(
    translator._n('%d item', '%d items', count, 'acme-cart'),
    count,
  );
}

/** Translate the cart action with an unambiguous context. @param translator Host-selected translator. @returns Plain button label. No globals or I/O. */
export function checkoutLabel(translator: Translator): string {
  return translator._x('Continue', 'checkout button', 'acme-cart');
}
```

Prefer stable source messages over concatenating translated fragments. Translators may need to reorder words; use positional `sprintf` placeholders or named `interpolate` values when the entire sentence needs translation. These return text, so render with text nodes or escape for the actual output context. Do not translate a URL scheme, permission identifier, database key or arbitrary HTML template as if it were display text.

## Publish one catalog module per locale and domain

```ts title="src/locales/fr.ts"
import type { Catalog } from 'zlocale';

const french = {
  locale: 'fr',
  domain: 'acme-cart',
  messages: {
    '%d item': { one: '%d article', other: '%d articles' },
    'checkout button\u0004Continue': 'Passer au paiement',
  },
} satisfies Catalog;

export default french;
```

The context separator in the TypeScript string above is the actual U+0004 escape. Include translator comments in source/review material to explain ambiguous wording. Plural categories follow native CLDR: Arabic/Russian need different categories from English. `other` is always required. Missing categories fall back to `other`; a missing catalog/message falls back to source text.

Use `satisfies Catalog` for authoring feedback and `defineCatalog(unknown)` when accepting runtime data. The registry/loader validates and freezes catalogs even if the source was already type-checked. TypeScript does not validate a downloaded JSON response.

## Preserve separate build exports

```json title="package.json excerpt"
{
  "name": "@example/cart",
  "type": "module",
  "sideEffects": false,
  "exports": {
    ".": {
      "types": "./dist/messages.d.ts",
      "default": "./dist/messages.js"
    },
    "./locales/fr": {
      "types": "./dist/locales/fr.d.ts",
      "default": "./dist/locales/fr.js"
    }
  },
  "files": ["dist", "README.md", "LICENSE"],
  "peerDependencies": { "zlocale": "^0.0.3" },
  "devDependencies": { "zlocale": "0.0.3" }
}
```

This is an excerpt, not a complete release manifest. Add the package's own version, license and build settings. `^0.0.3` intentionally accepts only that patch line under npm's 0.0.x rules; review later versions before broadening the range. Only declare `sideEffects: false` if it is true for your entire package.

Do not re-export every locale from the main entry. Hosts can then omit unused locales or split explicit dynamic imports into locale chunks. No extraction CLI, PO/MO parser, Jed converter or automatic bundler integration is supplied by zlocale 0.0.3; produce the documented catalog shape in your own build pipeline.

## Let the application load the catalog

```ts title="Host application startup"
import { createCatalogLoader, createI18n } from 'zlocale';

const loader = createCatalogLoader({
  'fr/acme-cart': () => import('@example/cart/locales/fr')
    .then(module => module.default),
});
// Startup preparation, before accepting requests or rendering a French page:
const catalogs = await loader.preload(['fr/acme-cart']);
const i18n = createI18n({ locale: 'fr', catalogs });
```

A server can preload all hot domains/locales once per runtime generation. A browser can import only the selected locale's required domains. In both cases `cartQuantity(i18n.forLocale('fr'), 2)` reads memory only. Do not build an import path from a query parameter, cookie or locale header. The allowlisted manifest maps input choices to known files.

Coordinate `maxCatalogs` with the number of locales times installed domains. Multiple packages using the same domain can overwrite each other's translations when replacement is enabled. Give each package a unique domain and have one host owner decide replacement/version policy. Package source fallbacks remain usable before optional translations load.

## Register a ZeruxJS plugin without owning the site's language

```ts title="Module package plugin entry"
import type { ZeruxPluginApi, ZeruxRequestContext } from 'zeruxjs';
import type { Translator } from 'zlocale';
import { cartQuantity } from './messages.js';

/** Register localized routes using host request policy. @param api Generation-scoped registration API. @param translatorFor Host callback returning the current request's locale-fixed translator. @param middleware Host-selected middleware names. @returns Nothing. Uses supplied context only; no global locale or I/O. */
export function registerCart(
  api: ZeruxPluginApi,
  translatorFor: (context: ZeruxRequestContext) => Translator,
  middleware: readonly string[] = [],
): void {
  api.addRoute({
    pattern: '/cart/label', method: 'GET', middleware: [...middleware],
    handler: context => ({ label: cartQuantity(translatorFor(context), 2) }),
  });
}
```

The site wraps this registration from its own discovered plugin, supplies its request-locale resolver and installs the catalogs before serving. For the named middleware in the site guide, call `registerCart(api, translatorFor, ['site.language'])` after registering that middleware. The module passes through the host-selected middleware names instead of assuming a global language policy. The package should not independently parse cookies, change a global locale, register a competing language preference or assume `api.service('i18n')` exists. The framework's managed service names do not include zlocale in this release.

If a module adds loaders, subscriptions or request-context owners, put lifecycle ownership in the host's generation/worker setup. Plugin registration is not an arbitrary returned-disposer lifecycle. A package with only message functions and immutable catalog data needs no background worker.

## Zyro components and other renderers

For reactive browser text, the host creates `createZyroI18n(i18n, signal)` from `zlocale/zyro`. Its return value implements `Translator`, so the same package functions can receive it. Read those functions inside reactive children/effects; a string calculated once outside an effect will not update itself.

For SSR or email/jobs, pass `i18n.forLocale(selectedLocale)` directly. Do not import `zlocale/node` into browser code. Do not instantiate another Zyro runtime in the translation package. Framework-neutral message functions keep the translation data usable across all of these hosts.

## Upgrade and verification checklist

Before publishing the module, pack it and inspect that each public locale export resolves from an isolated install. Check missing messages, explicit domains/contexts, intentional empty translations, CLDR counts, HTML-like text and unsupported locale choices. Test two concurrent server requests with different languages and a rapid browser language switch. Confirm that importing the main entry neither starts an application nor imports every locale.

Changing a source message/context/domain changes its lookup key; ship matching catalog updates. Adding translations does not justify changing another package's active language. Document catalog size, supported locales and whether a module's browser bundle actually includes its locale chunks. See [site language settings](/branch/v0.0.4/zeruxjs/docs/0.0.4/localization-site-settings.md) for the application's side of this contract.


## Implementation sources

- [packages/zlocale/src/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zlocale/src/types.ts)
- [packages/zlocale/src/core.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zlocale/src/core.ts)
- [packages/zlocale/src/loader.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zlocale/src/loader.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
