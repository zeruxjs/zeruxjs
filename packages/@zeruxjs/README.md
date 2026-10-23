# @zeruxjs packages

Modular services and adapters used by ZeruxJS applications. Each package defines its own exports and dependencies; consult its README for setup, ownership and limitations. The main framework is [`zeruxjs`](../zeruxjs/README.md), outside this namespace directory. MCP tools and transport helpers are part of [`zhost`](../zhost/README.md).

| Package | Purpose |
| --- | --- |
| [@zeruxjs/accessibility](accessibility/README.md) | DOM accessibility helpers with explicit lifecycle cleanup.
| [@zeruxjs/ai](ai/README.md) | Provider-agnostic chat with OpenAI-compatible *Chat Completions*, bounded buffered responses, incremental SSE text streaming, retries for explicit transient errors, fallbacks and concurrency limiting.
| [@zeruxjs/ai-model](ai-model/README.md) | A local dependency-light retrieval knowledge base, not a model-training or embedding runtime.
| [@zeruxjs/analytics](analytics/README.md) | Lightweight, opt-in, DB-backed application events.
| [@zeruxjs/asset-manager](asset-manager/README.md) | Validated in-memory asset catalog for images, video, fonts, color tokens, documents and branding assets.
| [@zeruxjs/auth](auth/README.md) | Server-side password hashing, encrypted sessions, user/role database facade, one-time passwords, RFC 6238 authenticator TOTP, scoped API/reset tokens, password policy, and optional revocation store.
| [@zeruxjs/cache](cache/README.md) | Application cache abstraction with a built-in bounded memory cache, external adapters, and a manager facade.
| [@zeruxjs/cache-redis](cache-redis/README.md) | Redis 5 adapter for @zeruxjs/cache.
| [@zeruxjs/db](db/README.md) | JSON-structured database operations, named connections and connector lifecycle management for ZeruxJS or standalone Node.js applications.
| [@zeruxjs/db-mongo](db-mongo/README.md) | JSON-query MongoDB connector for @zeruxjs/db.
| [@zeruxjs/db-mysql](db-mysql/README.md) | MySQL JSON-query connector using parameterized ? placeholders and mysql2/promise (loaded only when needed).
| [@zeruxjs/db-pg](db-pg/README.md) | PostgreSQL JSON-query connector.
| [@zeruxjs/db-sql-core](db-sql-core/README.md) | Shared parameterized SQL compiler and connector executor for PostgreSQL, MySQL and SQLite.
| [@zeruxjs/db-sqlite](db-sqllite/README.md) | SQLite connector for @zeruxjs/db using Node's built-in node:sqlite on supported runtimes or optional better-sqlite3.
| [@zeruxjs/email](email/README.md) | Multiple independent SMTP connections, Nodemailer transport reuse, password or OAuth2 authentication, optional pooling, DKIM, typed templates, email-safe HTML and tables, recipient suppression, batching, transient retry queues, attachment streams from @zeruxjs/files, and opt-in email analytics hooks.
| [@zeruxjs/feed](feed/README.md) | Modular RSS 2.0, Atom 1.0, and JSON Feed 1.1 generators.
| [@zeruxjs/files](files/README.md) | Multiple named storage connectors for binary objects, including local S3-lite and AWS S3-compatible providers (MinIO, RustFS, Ceph, etc.).
| [@zeruxjs/font](font/README.md) | Modular font-face generation and browser font loading.
| [@zeruxjs/hooks](hooks/README.md) | Server-side scoped hooks and path aliases for ZeruxJS.
| [@zeruxjs/lint](lint/README.md) | Composable ESLint, Stylelint CSS/SCSS and Prettier runners with typed results, bounded source file discovery, and disposable watch mode.
| [@zeruxjs/media](media/README.md) | Private, disk-backed binary media storage.
| [@zeruxjs/performance](performance/README.md) | Browser performance observations, resource hints, cache validators, reporting, and optional Lighthouse auditing.
| [@zeruxjs/queue](queue/README.md) | BullMQ-backed named job queues, durable Redis storage, optional worker processors, delayed/retried/repeatable jobs, and generation-scoped ZeruxJS startup/shutdown.
| [@zeruxjs/react](react/README.md) | Framework-neutral external-store primitives and injected React Hooks adapters.
| [@zeruxjs/reports](reports/README.md) | A structured report/page/chart designer over internal @zeruxjs/analytics events.
| [@zeruxjs/search](search/README.md) | Dependency-free, Unicode-aware in-memory search index.
| [@zeruxjs/security](security/README.md) | Framework-independent server security primitives.
| [@zeruxjs/seo](seo/README.md) | Modular page metadata and crawler files.
| [@zeruxjs/share](share/README.md) | Safe browser sharing, fallback handling, social share links and HTML metadata.
| [@zeruxjs/tags](tags/README.md) | Managed triggers, tags, data-layer variables, browser ttag() and server astag() APIs.
| [@zeruxjs/typescript](typescript/README.md) | TypeScript transpilation, typechecking, tsconfig generation, CommonJS compatibility and optional esbuild bundling.
| [@zeruxjs/validator](validator/README.md) | Schema validation and transformation utilities with synchronous and asynchronous parsers.
| [@zeruxjs/vue](vue/README.md) | Framework-independent ref primitives and observable/state-store adapters for Vue integrations.
| [@zeruxjs/zyro](zyro/README.md) | Core observable state with batched notifications, stable selected snapshots, bridges and cancelable async resources.
