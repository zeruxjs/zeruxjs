# A plain-language glossary

Understand the words used in the handbook, with a concrete meaning and the next place to look.


## The web request

| Term | Plain-language meaning | Next step |
| --- | --- | --- |
| Browser/client | The visitor's application that asks for content and displays it | [Foundations](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn-foundations.md) |
| Server | The running process that receives a request and answers it | [First route](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn-first-route.md) |
| Request/response | The question sent over HTTP and the answer returned | [Request lifecycle](/branch/v0.0.4/zeruxjs/docs/0.0.4/request-lifecycle.md) |
| Route | A mapping from HTTP method/path to a handler | [Routing](/branch/v0.0.4/zeruxjs/docs/0.0.4/routing.md) |
| Handler | A function that processes a request and returns a result | [First route](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn-first-route.md) |
| Middleware | Code wrapping downstream request work | [Middleware](/branch/v0.0.4/zeruxjs/docs/0.0.4/middleware.md) |
| JSON | A text representation of data, not a rendered UI | [Input lesson](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn-input.md) |

## Building and running code

| Term | Plain-language meaning | Next step |
| --- | --- | --- |
| Terminal | A window for running commands in a chosen directory | [First route](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn-first-route.md) |
| npm script | A named command declared in package.json | [Solution finder](/branch/v0.0.4/zeruxjs/docs/0.0.4/solutions.md) |
| Package/library | Installable code with a public import contract | [Package directory](/branch/v0.0.4/zeruxjs/docs/0.0.4/packages.md) |
| Framework | A coordinator for an application's structure/lifecycle | [Mental model](/branch/v0.0.4/zeruxjs/docs/0.0.4/mental-model.md) |
| TypeScript/typecheck | Development-time checking of declared code contracts | [TypeScript](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) |
| Build/compile | Transform source into runnable output | [Release lesson](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn-release.md) |
| SSR | Render HTML on the server (or during a static build) | [Frontend SSR](/branch/v0.0.4/zeruxjs/docs/0.0.4/frontend-ssr.md) |
| Static export | Prebuilt files served without running application handlers | [Deployment](/branch/v0.0.4/zeruxjs/docs/0.0.4/deployment.md) |
| Generation | One prepared set of runtime resources, replaceable on reload | [Service lifecycle](/branch/v0.0.4/zeruxjs/docs/0.0.4/service-lifecycle.md) |

## Data and security

| Term | Plain-language meaning | Next step |
| --- | --- | --- |
| Validation | Check the actual shape/size/allowed values of incoming data | [Input lesson](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn-input.md) |
| Authentication | Establish who a caller is | [Auth/security setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-auth-security.md) |
| Authorization | Decide whether that caller may perform this action on this resource | [Input lesson](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn-input.md) |
| Tenant | A separately owned account/organization boundary in a shared application | [Tenant data](/branch/v0.0.4/zeruxjs/docs/0.0.4/tenant-data.md) |
| Database | Persistent record storage managed through an explicit connector | [Database setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-database.md) |
| Cache | Reusable temporary results with a deliberate owner/key/lifetime | [Cache setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-cache.md) |
| Environment variable | A process setting supplied outside source, often including server secrets | [Environment](/branch/v0.0.4/zeruxjs/docs/0.0.4/environment.md) |

## Language and the handbook

| Term | Plain-language meaning | Next step |
| --- | --- | --- |
| i18n | Prepare code/messages to support languages (internationalization) | [Language lesson](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn-language.md) |
| l10n | Supply translations and local display conventions (localization) | [Site languages](/branch/v0.0.4/zeruxjs/docs/0.0.4/localization-site-settings.md) |
| Locale | A language/region convention tag such as fr-CA | [zlocale](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-zlocale.md) |
| Domain/catalog | A feature's message namespace and its translation data | [Module authoring](/branch/v0.0.4/zeruxjs/docs/0.0.4/localization-package-authoring.md) |
| RTL | Right-to-left writing direction; layout needs deliberate handling too | [Site languages](/branch/v0.0.4/zeruxjs/docs/0.0.4/localization-site-settings.md) |
| PWA/offline reading | Optional installation/cache support for these static docs | [Handbook controls](/branch/v0.0.4/zeruxjs/docs/0.0.4/handbook-help.md) |
| Local progress | Learning data in this browser, with no account/sync/certification | [Course](/branch/v0.0.4/zeruxjs/docs/0.0.4/learn.md) |


## Implementation sources

- [apps/zerux-docs/src/lib/academy.mjs](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/apps/zerux-docs/src/lib/academy.mjs)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/types.ts)
- [packages/zlocale/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zlocale/src/index.ts)
