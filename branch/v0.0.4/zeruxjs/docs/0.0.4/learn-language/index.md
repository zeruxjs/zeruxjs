# 6. Build a language-aware feature

Translate a message with a catalog, then keep browser and server locale choices safe.


## Your goal

Create a small catalog, translate a greeting and quantity, and explain why a shared server cannot use one mutable language for all requests.

## Prepare a typed catalog

```sh
npm install zlocale@0.0.3
```

```ts title="locales/fr.ts"
import { defineCatalog } from 'zlocale';
export default defineCatalog({
  locale: 'fr', domain: 'site',
  messages: {
    Welcome: 'Bienvenue',
    '%d item': { one: '%d article', other: '%d articles' },
  },
});
```

A **locale** identifies language/region conventions. A **domain** separates one feature's messages from another. A **catalog** is data: source keys mapped to translated strings/plural categories. These words are also in [the glossary](/branch/v0.0.4/zeruxjs/docs/0.0.4/glossary.md).

## Read a prepared message

```ts title="An application-owned translator"
import { createI18n, sprintf } from 'zlocale';
import french from './locales/fr.js';

const i18n = createI18n({ locale: 'fr', domain: 'site', catalogs: [french] });
const greeting = i18n.__('Welcome');
const count = sprintf(i18n._n('%d item', '%d items', 2), 2);
// Expected: greeting === 'Bienvenue'; count === '2 articles'
```

No disk or network read occurs in `__` or `_n`. The host has already registered the catalog. Missing messages return source text; plural categories use native Intl/CLDR rules. `other` is mandatory, and languages may need more categories than English.

## Choose the right owner

On a server, pass `i18n.forLocale(validatedLocale)` into a handler/module, or use `createRequestI18n` from `zlocale/node` around the awaited downstream request. Do not call shared `i18n.setLocale` independently for simultaneous requests.

In a browser application, `setLocale` can change the application-owned locale after catalogs are ready. `createLocaleController` protects rapid language changes from stale async results. `createZyroI18n` connects reads to Zyro's signal factory so visible text can update. Changing `<html lang>` alone does not translate the page.

## Load only what the host needs

Use literal, allowlisted import functions for locale chunks. Never concatenate a cookie, header or query value into an import path. A module contributes its catalog; the host chooses supported languages, required domains and preference persistence. SSR can transfer an explicit public catalog subset with `serializeCatalogs`/branch/v0.0.4/`parseCatalogs`.

For a complete implementation, read [site language settings](/branch/v0.0.4/zeruxjs/docs/0.0.4/localization-site-settings.md). To publish reusable translated features, read [module/plugin authoring](/branch/v0.0.4/zeruxjs/docs/0.0.4/localization-package-authoring.md). Both use the same package contract with different ownership.

## Try it yourself

Add an English catalog and a second French message. Read each through locale-fixed translators without changing the owner locale. Ask for an unknown message and inspect the fallback. Then explain why a private French response and a public English response should not share an unpartitioned cache key.

**You are done when:** you can demonstrate translation/fallback and explain when catalogs load, who chooses locale and where request isolation lives.


## Check your understanding

1. How should concurrent server requests choose different languages?
   - 1. Change a shared global locale for each request
   - 2. Use a locale-fixed translator or request-local context
   - 3. Reload the entire package for each message

Answer: Use a locale-fixed translator or request-local context. Locale-fixed views and AsyncLocalStorage prevent one request from changing another request’s language.

2. When does __(text) load a catalog file?
   - 1. On every call
   - 2. Only on weekends
   - 3. It never loads files; the host explicitly preloads/registers catalogs

Answer: It never loads files; the host explicitly preloads/registers catalogs. Translation reads are synchronous in-memory lookups. Loading is a separate explicit async boundary.

Confirm that you tried the lesson exercise. Optional points/progress are stored only by the browser interface.


## Implementation sources

- [apps/zerux-docs/src/lib/academy.mjs](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/apps/zerux-docs/src/lib/academy.mjs)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
- [packages/zlocale/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zlocale/src/index.ts)
