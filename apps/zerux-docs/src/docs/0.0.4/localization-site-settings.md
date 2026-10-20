---
{
  "title": "Configure site languages",
  "description": "Choose default language, supported locales, request policy, browser preferences and module catalogs with zlocale.",
  "section": "Configuration",
  "order": 178,
  "sources": [
    "packages/zlocale/src/core.ts",
    "packages/zlocale/src/controller.ts",
    "packages/zlocale/src/node.ts",
    "packages/zlocale/src/snapshot.ts",
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/bootstrap/types.ts"
  ],
  "related": [
    "reference-zlocale",
    "localization-package-authoring",
    "zerux-config",
    "middleware",
    "frontend-ssr"
  ]
}
---

## What the site owns

The site chooses its default language, supported locale allowlist, display timezone, locale URL/preference policy and required text domains. A module/plugin contributes message functions and catalogs for its own domain. Translation functions do not inspect a request or open files; they use the translator selected by the host.

Install `zlocale@0.0.3`. Use `zlocale` in browser/server/shared code, `zlocale/node` only on Node, and `zlocale/zyro` when connecting reactive UI. This guide describes application integration. Installing the package does not automatically add a framework-managed `i18n` service, negotiate Accept-Language or build localized routes.

## Define one typed language policy

```ts title="language-settings.ts"
export interface SiteLanguageSettings {
  defaultLocale: string;
  supportedLocales: readonly string[];
  fallbackLocales: readonly string[];
  timeZone: string;
}

export const languageSettings = {
  defaultLocale: 'en',
  supportedLocales: ['en', 'fr', 'ar'],
  fallbackLocales: ['en'],
  timeZone: 'UTC',
} as const satisfies SiteLanguageSettings;
```

Keep language and country separate: a language choice is not a currency, tax jurisdiction or user timezone. Use precise BCP-47 tags such as `fr-CA` when the site actually has regional behavior. Catalog lookup can fall back to parent locales, while the async locale controller expects explicit catalogs for the chosen base locale. If you support `fr-CA`, either provide its controller manifest entry or design an explicit host loader that supplies the correct base catalog; do not assume it automatically imports `fr`.

Validate settings once at startup. `createI18n` validates canonical locale and timezone syntax, but the host must also ensure the default is supported, settings are nonempty/bounded and all required domain catalogs exist. Dynamic settings loaded from a database need runtime validation before they replace the current policy; a TypeScript interface alone is insufficient.

## Include application settings in zerux.config.js or zerux.config.ts

```ts title="zerux.config.ts"
import type { ZeruxConfig } from 'zeruxjs';
import { languageSettings, type SiteLanguageSettings } from './language-settings.js';

type SiteConfig = ZeruxConfig & { appLanguage: SiteLanguageSettings };
export default {
  type: 'fix',
  structure: { plugins: ['plugins'] },
  appLanguage: languageSettings,
} satisfies SiteConfig;
```

`appLanguage` here is a custom application-owned namespace. ZeruxJS allows custom config fields, but neither the framework bootstrap nor zlocale consumes this key automatically. Your plugin reads it, validates it, preloads catalogs and creates the translator. This keeps the setting alongside DB/cache configuration without pretending it is a built-in service option.

For an ESM `zerux.config.js`, use the same object with a JavaScript settings module and `/** @type {import('zeruxjs').ZeruxConfig & {appLanguage: import('./language-settings.js').SiteLanguageSettings}} */` where your settings module exports the corresponding JSDoc type. Keep one active config file. Do not put private profile data or credentials in these public language settings, or serialize the whole framework config to the browser.

## Preload the server's active catalog set

```ts title="Public catalog modules"
import { defineCatalog } from 'zlocale';

export const publicSiteCatalogs = [
  defineCatalog({ locale: 'en', domain: 'site', messages: { Welcome: 'Welcome' } }),
  defineCatalog({ locale: 'fr', domain: 'site', messages: { Welcome: 'Bienvenue' } }),
  defineCatalog({ locale: 'ar', domain: 'site', messages: { Welcome: 'مرحبا' } }),
];
```

For a small site, import these catalogs at startup. For large catalogs, use `createCatalogLoader` with literal allowlisted imports, then explicitly `preload` the hot locale/domain combinations before the server accepts requests. Module catalogs such as `fr/acme-cart` belong in the same host-owned loading plan. Choose a catalog capacity for locales times domains; the default registry holds at most 64 catalogs.

The registry and native Intl formatter cache are application-owned and bounded. Translation calls perform no filesystem/network I/O. For rarely visited locales, warm catalogs in deployment/background work or use an explicit prepared route boundary; do not hide a cold disk read in every translation or request. A loader cache and an i18n registry are separate owners: clearing one does not evict the other automatically.

## Register a request-safe ZeruxJS site plugin

This example uses a small, preloaded public catalog set and a `?lang=` policy. It stores a locale-fixed translator in request state so routes/modules do not mutate a shared language. The named middleware is explicitly attached to the route.

```ts title="plugins/site-language.ts"
import type { ZeruxPluginApi, ZeruxRequestContext } from 'zeruxjs';
import { createI18n, type Translator } from 'zlocale';
import { languageSettings } from '../language-settings.js';
import { publicSiteCatalogs } from '../locales/site.js';

/** Resolve an untrusted language preference against the site allowlist. @param value Query/cookie/profile value. @returns A supported locale. Uses explicit settings only; no I/O. */
function selectLocale(value: unknown): string {
  return typeof value === 'string' &&
    (languageSettings.supportedLocales as readonly string[]).includes(value)
      ? value : languageSettings.defaultLocale;
}

/** Retrieve a translator set by the site's route middleware. @param context Current request. @returns Locale-fixed translator. Reads request state only; never initializes a service. */
export function translatorFor(context: ZeruxRequestContext): Translator {
  const candidate = context.state.siteTranslator as Translator | undefined;
  if (!candidate || typeof candidate.__ !== 'function') {
    throw new Error('Site language middleware did not run');
  }
  return candidate;
}

/** Register generation-owned locale data and request policy. @param api Plugin API. @returns Nothing. Reads validated public language settings and request query only; no environment, cookie or filesystem access. */
export default function register(api: ZeruxPluginApi): void {
  const i18n = createI18n({
    locale: languageSettings.defaultLocale,
    fallbackLocales: languageSettings.fallbackLocales,
    timeZone: languageSettings.timeZone,
    domain: 'site', catalogs: publicSiteCatalogs,
  });
  api.addMiddleware('site.language', async (context, next) => {
    const locale = selectLocale(context.query.get('lang'));
    context.state.siteTranslator = i18n.forLocale(locale);
    context.res.setHeader('Content-Language', locale);
    context.setCache({ visibility: 'private' });
    await next();
  });
  api.addRoute({
    pattern: '/welcome', method: 'GET', middleware: ['site.language'],
    handler: context => ({ message: translatorFor(context).__('Welcome') }),
  });
}
```

The config example and settings module intentionally reference the same exported policy. If settings come from `api.getConfig().appLanguage` instead, treat that value as unknown, validate it at registration and pass the validated result into the same factory. `api.setComposable` can expose an application-owned translator facade to other routes; it is distinct from `api.service`, whose managed service names are fixed by the framework.

Do not call `i18n.setLocale` per request on this shared owner. `forLocale` avoids mutable request state entirely. If deeply nested server code needs ambient request lookup, use `createRequestI18n` from `zlocale/node` and wrap the actual awaited downstream handler with `run(locale, next)`; its AsyncLocalStorage context isolates concurrent requests. The host owns its `dispose()` after in-flight work finishes. Do not return an arbitrary disposer from plugin registration and assume the framework invokes it; use a managed worker/lifecycle owner for such cleanup.

## Choose language precedence and persistence deliberately

A practical policy is explicit localized URL, then authenticated saved preference, then validated cookie, then an explicitly negotiated Accept-Language value, then the site default. This ordering is a site policy, not implemented automatically by zlocale. The minimal example above only reads `?lang=` and falls back to the default. It does not claim to parse Accept-Language weights or authenticate a profile preference.

Never concatenate a preference into a file path or import expression. Invalid/unsupported choices should fall back or receive a deliberate 400 response; a supported locale is not a permission to access another tenant's settings. Save authenticated profile preferences through your normal authorization/CSRF policy. Browser storage is optional UI convenience, untrusted on read and unavailable to the server. A public language preference cookie is not an authentication cookie; choose cookie path/lifetime/SameSite/Secure policy in the host.

For public SEO pages, locale-specific URLs such as `/fr/about` make links shareable and cache keys explicit. The application must create those routes, canonical URLs and hreflang links; zlocale does not do it. `Content-Language` does not create localized URLs or partition a CDN cache. Include locale, domain/template revision and relevant timezone/currency in application cache keys. Use `Vary: Accept-Language` only when that header actually selects the response; personalized profile/cookie responses usually require private caching.

## Add a browser language control

Provide labels in each language, a persistent visible field label and a status region. The host chooses how its bundled application obtains the initial server-selected locale and public catalogs.

```html
<label for="site-language">Language</label>
<select id="site-language">
  <option value="en">English</option>
  <option value="fr">Français</option>
  <option value="ar">العربية</option>
</select>
<p id="language-status" role="status" aria-live="polite"></p>
```

```ts title="Browser application language owner"
import { createCatalogLoader, createI18n, createLocaleController } from 'zlocale';

const i18n = createI18n({ locale: 'en', domain: 'site', timeZone: 'UTC' });
const loader = createCatalogLoader({
  'en/site': () => import('./locales/en.js').then(module => module.default),
  'fr/site': () => import('./locales/fr.js').then(module => module.default),
  'ar/site': () => import('./locales/ar.js').then(module => module.default),
});
const controller = createLocaleController(i18n, loader, {
  supportedLocales: ['en', 'fr', 'ar'], domains: ['site'],
});
const select = document.querySelector<HTMLSelectElement>('#site-language');
const status = document.querySelector<HTMLElement>('#language-status');
if (!select || !status) throw new Error('Missing language controls');
let changeId = 0;

/** Apply a supported selection after its catalogs load. @param event Select change. @returns Completion. Reads the select and updates document language/status only; host loaders may fetch bundled chunks. */
async function onLanguageChange(event: Event): Promise<void> {
  const id = ++changeId;
  const locale = (event.currentTarget as HTMLSelectElement).value;
  status!.textContent = 'Loading language…';
  try {
    const applied = await controller.switchLocale(locale);
    if (!applied || id !== changeId) return;
    document.documentElement.lang = i18n.getLocale();
    document.documentElement.dir = i18n.isRTL() ? 'rtl' : 'ltr';
    status!.textContent = '';
  } catch {
    if (id !== changeId) return;
    select!.value = i18n.getLocale();
    status!.textContent = 'The language could not be loaded. Please try again.';
  }
}
select.addEventListener('change', onLanguageChange);
// During host teardown: invalidate pending UI results, remove the listener and dispose.
// ++changeId; select.removeEventListener('change', onLanguageChange); controller.dispose();
```

Initialize the first locale/catalogs before the first render, or hydrate the public server snapshot described below. The example's English status text is illustrative; a complete UI translates its own loading/error/accessibility messages too. If modules contribute domains, add those manifest imports and include the domains in the controller's required set. Every selected locale must provide that complete set. A failed current load leaves the previous locale active; obsolete selections resolve false. Do not persist a preference until it successfully applies. If you use localStorage, catch access/storage errors and validate stored values against the same allowlist.

The controller changes translation state. A UI must also render reactively: use `createZyroI18n(i18n, signal)` and call its methods inside reactive children, or subscribe with another renderer. Setting `<html lang>` alone does not translate existing DOM text. For RTL layouts use CSS logical properties and deliberate directional icons; `isRTL` does not rewrite styles.

## SSR hydration and data exposure

On the server, `serializeCatalogs(publicPageCatalogs)` produces an HTML-safe JSON data-block payload. Send only the public locale/domain subset the page requires. On the client, read that block's `textContent`, call `parseCatalogs`, and pass its catalogs to `createI18n` before mounting. Keep the same selected locale, timezone and fallback settings on both sides. Do not refetch the same catalogs just to reconstruct server-rendered text.

Use a non-executable `script[type="application/json"]` data block, never eval or raw string interpolation into a JavaScript program. Escaping prevents HTML script breakout; it does not remove confidential data. Do not serialize database configuration, a profile object, cookies, tokens or an entire request. Formatting can differ across ICU/CLDR deployments; test the actual server/browser versions when exact hydration text matters.

## Multi-site policy, operations and failures

Use a separate catalog/settings owner for each tenant/runtime boundary when settings or private translations differ. Shared immutable public catalogs may be reused, but a global mutable site locale is unsafe. Background jobs receive a saved validated locale and use a fixed translator, rather than expecting an HTTP request context to exist. Load only a tenant's explicitly approved domains.

Verify the default and every supported locale, missing-message fallback, plural counts, regional tags, UTC/user timezone choices, concurrent requests and rapid browser selections. Test a rejected locale chunk, private/shared-cache isolation, accessible language control, RTL text/layout and host teardown. Record missing catalog/deployment failures without logging private translated messages or profile values. A browser-only locale change does not persist a server preference unless the application explicitly saves it.
