---
{
  "title": "A plain-language glossary",
  "description": "Understand the words used in the handbook, with a concrete meaning and the next place to look.",
  "section": "Getting started",
  "order": 6,
  "sources": [
    "apps/zerux-docs/src/lib/academy.mjs",
    "packages/zeruxjs/src/bootstrap/types.ts",
    "packages/zlocale/src/index.ts"
  ],
  "related": [
    "learn",
    "solutions",
    "reference-zlocale"
  ]
}
---

## The web request

| Term | Plain-language meaning | Next step |
| --- | --- | --- |
| Browser/client | The visitor's application that asks for content and displays it | [Foundations](learn-foundations.md) |
| Server | The running process that receives a request and answers it | [First route](learn-first-route.md) |
| Request/response | The question sent over HTTP and the answer returned | [Request lifecycle](request-lifecycle.md) |
| Route | A mapping from HTTP method/path to a handler | [Routing](routing.md) |
| Handler | A function that processes a request and returns a result | [First route](learn-first-route.md) |
| Middleware | Code wrapping downstream request work | [Middleware](middleware.md) |
| JSON | A text representation of data, not a rendered UI | [Input lesson](learn-input.md) |

## Building and running code

| Term | Plain-language meaning | Next step |
| --- | --- | --- |
| Terminal | A window for running commands in a chosen directory | [First route](learn-first-route.md) |
| npm script | A named command declared in package.json | [Solution finder](solutions.md) |
| Package/library | Installable code with a public import contract | [Package directory](packages.md) |
| Framework | A coordinator for an application's structure/lifecycle | [Mental model](mental-model.md) |
| TypeScript/typecheck | Development-time checking of declared code contracts | [TypeScript](typescript.md) |
| Build/compile | Transform source into runnable output | [Release lesson](learn-release.md) |
| SSR | Render HTML on the server (or during a static build) | [Frontend SSR](frontend-ssr.md) |
| Static export | Prebuilt files served without running application handlers | [Deployment](deployment.md) |
| Generation | One prepared set of runtime resources, replaceable on reload | [Service lifecycle](service-lifecycle.md) |

## Data and security

| Term | Plain-language meaning | Next step |
| --- | --- | --- |
| Validation | Check the actual shape/size/allowed values of incoming data | [Input lesson](learn-input.md) |
| Authentication | Establish who a caller is | [Auth/security setup](configuration-auth-security.md) |
| Authorization | Decide whether that caller may perform this action on this resource | [Input lesson](learn-input.md) |
| Tenant | A separately owned account/organization boundary in a shared application | [Tenant data](tenant-data.md) |
| Database | Persistent record storage managed through an explicit connector | [Database setup](configuration-database.md) |
| Cache | Reusable temporary results with a deliberate owner/key/lifetime | [Cache setup](configuration-cache.md) |
| Environment variable | A process setting supplied outside source, often including server secrets | [Environment](environment.md) |

## Language and the handbook

| Term | Plain-language meaning | Next step |
| --- | --- | --- |
| i18n | Prepare code/messages to support languages (internationalization) | [Language lesson](learn-language.md) |
| l10n | Supply translations and local display conventions (localization) | [Site languages](localization-site-settings.md) |
| Locale | A language/region convention tag such as fr-CA | [zlocale](reference-zlocale.md) |
| Domain/catalog | A feature's message namespace and its translation data | [Module authoring](localization-package-authoring.md) |
| RTL | Right-to-left writing direction; layout needs deliberate handling too | [Site languages](localization-site-settings.md) |
| PWA/offline reading | Optional installation/cache support for these static docs | [Handbook controls](handbook-help.md) |
| Local progress | Learning data in this browser, with no account/sync/certification | [Course](learn.md) |
