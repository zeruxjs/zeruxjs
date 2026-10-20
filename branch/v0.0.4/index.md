# ZeruxJS — Build your idea. Connect your stack.

From the first route to the services behind it. ZeruxJS brings your Node.js application together, with focused TypeScript tools you can use along the way.

Early development. Open source. Explore the current capabilities in the docs.

[Start building](/branch/v0.0.4/zeruxjs/docs/0.0.4/tutorial/) · [Documentation](/branch/v0.0.4/zeruxjs/) · [GitHub](https://github.com/zeruxjs/zeruxjs)

## Your ambition is big. Your stack can stay connected.

- **One request. Connected services.** Routes, configuration, middleware, plugins and application lifecycle management share a common runtime.
- **Your stack. Your building blocks.** Use the framework or focused packages. Choose adapters for databases, cache, files and email around your application's needs.
- **TypeScript, all the way through.** Typed request contexts, configuration and public APIs, with source-linked guides explaining setup and boundaries.

## Start small. Connect as you grow.

1. Define the application in `zerux.config.js`: describe the structure and services it uses.
2. Add file-based routes, middleware and plugins. Connect adapters as your application grows.
3. Compile your application, check its configuration and follow the deployment guide for your environment.

[Understand the runtime](/branch/v0.0.4/zeruxjs/docs/0.0.4/mental-model/) · [Explore configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-handbook/)

```ts
// app/api/hello/route.ts
export function GET() {
  return { message: "Hello, possibility.", ready: true };
}
```

## One ecosystem. Different ways to build.

- **ZeruxJS — early development.** The application runtime: routes, middleware, lifecycle hooks, workers and connected services. [Explore the framework](/branch/v0.0.4/zeruxjs/).
- **ZyroJS — available, evolving.** Standalone reactive primitives, DOM rendering and lifecycle helpers. [Explore the library](https://github.com/zeruxjs/zeruxjs/tree/master/packages/zyrojs).
- **ZenixJS — planned, placeholder.** A future CMS built around the ecosystem. Current packages expose placeholder metadata, not a working CMS. [Follow development](https://github.com/zeruxjs/zeruxjs/tree/master/packages/zenixjs).

## The right tool for the next step.

Explore 48 public packages for data, styling, security, development and more.

- [@zenixjs/core](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-zenixjs-core/) — Placeholder for the future Zenix CMS (v0.0.3)
- [@zeruxjs/accessibility](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-accessibility/) — Accesibilty Provider (v0.0.3)
- [@zeruxjs/ai](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-ai/) — AI Funtion Provider to easily connect APIs and Front-Backend too (v0.0.3)
- [@zeruxjs/ai-model](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-ai-model/) — Document retrieval, bounded evidence excerpts and grounded prompt adapter; does not train model weights. (v0.0.3)
- [@zeruxjs/analytics](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-analytics/) — Database-backed application and email event analytics with Fetch endpoints (v0.0.3)
- [@zeruxjs/asset-manager](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-asset-manager/) — Asset Manager, Help naming asset and manage them on the go, best for managing branding and your identity assets by arrangeing them, can be for Logo, Images, Video but not limited to assets, can be add Color, font and more (v0.0.3)
- [@zeruxjs/auth](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-auth/) — Provide all AUth option from Password, OTP Verification, Reverification, Password Change, Oauth, Third-Party Provider (Add more option), Login/Register/Reset Form (with @zerux/form), Passkey, Authanticator Apps, Session Management, App passwords, API keys and more. (v0.0.3)
- [@zeruxjs/cache](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-cache/) — cache on browser application (v0.0.3)
- [@zeruxjs/cache-redis](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-cache-redis/) — Redis cache helper supporting node-redis and ioredis, with BullMQ connection settings. (v0.0.3)
- [@zeruxjs/db](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-db/) — A powerful library that can connect with database with similar JSON structured query. (v0.0.3)
- [@zeruxjs/db-mongo](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-db-mongo/) — Helper for @zerux/db for MongoDB Database. (v0.0.3)
- [@zeruxjs/db-mysql](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-db-mysql/) — Helper for @zerux/db for MySQL Database. (v0.0.3)
- [@zeruxjs/db-pg](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-db-pg/) — Helper for @zerux/db for Postgre Database. (v0.0.3)
- [@zeruxjs/db-sql-core](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-db-sql-core/) — Internal SQL compiler and executor helpers for ZeruxJS database connectors. (v0.0.3)
- [@zeruxjs/db-sqlite](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-db-sqlite/) — Helper for @zerux/db for SQL-Lite Database. (v0.0.3)
- [@zeruxjs/email](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-email/) — Multi-account SMTP send, IMAP/POP3 receive, parsing, durable inbox, campaigns and tracking (v0.0.3)
- [@zeruxjs/feed](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-feed/) — Feed creator (v0.0.3)
- [@zeruxjs/files](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-files/) — Multi-store filesystem, S3-compatible object storage and streaming Fetch file APIs (v0.0.3)
- [@zeruxjs/font](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-font/) — Font Adding and Using (v0.0.3)
- [@zeruxjs/hooks](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-hooks/) — Request-scoped React-style hooks, context, and safe ZeruxJS path registry (v0.0.3)
- [@zeruxjs/lint](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-lint/) — Composable ESLint, Stylelint CSS/SCSS and Prettier runners for ZeruxJS (v0.0.3)
- [@zeruxjs/media](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-media/) — Download and Upload Media, Making them enter only in non-executable area, Download Manager, expiry function and more. (v0.0.3)
- [@zeruxjs/performance](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-performance/) — Performance metrics, resource hints, cache directives and timing utilities. (v0.0.3)
- [@zeruxjs/queue](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-queue/) — BullMQ-backed queues and workers with ZeruxJS lifecycle management (v0.0.3)
- [@zeruxjs/react](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-react/) — External stores, stable selectors and React useSyncExternalStore bridge without bundled React. (v0.0.3)
- [@zeruxjs/reports](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-reports/) — Authenticated report builder backed by internal Zerux analytics (v0.0.3)
- [@zeruxjs/search](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-search/) — Powerfull Search (v0.0.3)
- [@zeruxjs/security](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-security/) — A security Plugin to secure application by auto CFSR, XSS and many other attacks, validate schema, escaping, sanitization, CROS, and much more (v0.0.3)
- [@zeruxjs/seo](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-seo/) — SEO Helper (v0.0.3)
- [@zeruxjs/share](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-share/) — Share Button Helper (v0.0.3)
- [@zeruxjs/tags](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-tags/) — Server and browser tag manager with versioned containers, triggers and destinations (v0.0.3)
- [@zeruxjs/typescript](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-typescript/) — TypeScript transpilation, typechecking, loaders and fast builds for ZeruxJS (v0.0.3)
- [@zeruxjs/validator](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-validator/) — Type-safe schema and HTTP input validation for ZeruxJS (v0.0.3)
- [@zeruxjs/vue](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-vue/) — Reactive ref compatibility, derived refs and Vue state adapters. (v0.0.3)
- [@zeruxjs/zyro](/branch/v0.0.4/zeruxjs/docs/0.0.4/package-zyro/) — Observable state, selectors, external-store bridges and asynchronous observation. (v0.0.3)
- [create-zenix-js](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-create-zenix-js/) — Placeholder CLI for the future Zenix CMS project generator (v0.0.3)
- [create-zerux-js](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-create-zerux-js/) — Placeholder CLI for the future ZeruxJS project generator (v0.0.3)
- [create-zyro-app](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-create-zyro-app/) — Placeholder CLI for the future ZyroJS project generator (v0.0.3)
- [zclivo](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-zclivo/) — Composable multi-command CLI and secure opt-in plugin registry for ZeruxJS (v0.0.3)
- [zenixjs](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-zenixjs/) — Placeholder for the future Zenix CMS (v0.0.3)
- [zeruxjs](/branch/v0.0.4/zeruxjs/docs/0.0.4/framework-package/) — Main application ZeruxJS Framework (v0.0.3)
- [zforge](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-zforge/) — Dev tools present here like mapping function and classes and all internal services (v0.0.3)
- [zhost](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-zhost/) — Server Creator and Handle Auto load and so via @zerux/watcher (v0.0.3)
- [zlocale](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-zlocale/) — Bounded gettext-style i18n and native Intl localization for Node.js, ZeruxJS and ZyroJS (v0.0.3)
- [zlook](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-zlook/) — File Change Watcher, Optize for multiple watcher together by sharing events (v0.0.3)
- [ztrial](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-ztrial/) — Modular testing framework and assertion toolkit for ZeruxJS, ZyroJS and JavaScript (v0.0.3)
- [zuixs](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-zuixs/) — Zero-dependency utility-first CSS compiler for ZeruxJS, ZyroJS, React, Vue, Next and Nuxt (v0.0.3)
- [zyrojs](/branch/v0.0.4/zeruxjs/docs/0.0.4/reference-zyrojs/) — Standalone signal reactivity, lifecycle-managed DOM rendering, and abortable network clients (v0.0.3)

## Make room for your next idea.

Follow a working application tutorial. Get to know the runtime. Build something, understand the pieces, and help shape what comes next.

```sh
npm install zeruxjs
```

Follow the [tutorial](/branch/v0.0.4/zeruxjs/docs/0.0.4/tutorial/) for complete setup requirements.
