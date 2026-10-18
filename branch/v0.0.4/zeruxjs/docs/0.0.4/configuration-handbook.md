# Application configuration handbook

Choose the correct runtime setup, inspect every option and verify a complete typed application.


## Configure by responsibility

Start with the application's owning process and the feature you need. `zerux.config.js`/branch/v0.0.4/`.ts` is server startup input. Some packages participate in managed service startup; other packages are explicit factories or browser helpers. A property accepted by an open TypeScript type is not proof of a runtime consumer.

| Responsibility | Configuration chapter | What it establishes |
| --- | --- | --- |
| Config file/export/precedence | [zerux.config.js](/branch/v0.0.4/zeruxjs/docs/0.0.4/zerux-config.md) | Which module is loaded and when |
| Paths, modules and environment | [Structure](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-structure.md) | Relative discovery paths and environment timing |
| Listener and hosts | [Server](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-server.md) | Actual CLI/config precedence and host policy |
| Named databases/adapters | [Database](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-database.md) | Connection slugs, default manager and ownership |
| Memory/Redis caching | [Cache](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-cache.md) | Adapter, namespace, TTL and required policy |
| Local/S3 object stores | [Files](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-files.md) | Store drivers, access limits and private roots |
| SMTP, inbound and campaigns | [Email](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-email.md) | Account setup and independent opt-in features |
| Internal events and collector | [Analytics](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-analytics.md) | Database binding and bounded ingestion |
| Browser/server event destinations | [Tags](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-tags.md) | Consent, shared stores and protected administration |
| Charts/studio | [Reports](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reports.md) | Authorization, tenant scope and data coverage |
| Durable job processing | [Queue](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-queue.md) | Redis, named producers/workers and retries |
| Lifecycle/thread work | [Workers](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-workers.md) | Pool defaults and task lifetime |
| RPC/MCP and other protocols | [Protocols](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-protocols.md) | Registration, authorization and body/origin limits |
| Server/browser appearance helpers | [Theme](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-theme.md) | Mode/cookie/script defaults and compatibility |
| Login/request enforcement | [Auth/security](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-auth-security.md) | Explicit setup and current automatic-integration limits |

## Follow a complete setup sequence

1. Create a minimal ESM application and one working route using [installation](/branch/v0.0.4/zeruxjs/docs/0.0.4/installation.md).
2. Add strict checking from the [TypeScript guide](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md), even if production output is bundled/transpiled separately.
3. Configure paths and allowed hosts. Keep private environment, database and upload paths outside public assets.
4. Enable one service and its actual prerequisites. Confirm readiness and perform one real operation before adding a dependent service.
5. Test invalid input, missing infrastructure and shutdown. Choose required/degraded behavior intentionally.
6. Build the production artifact and repeat the request with the deployment environment and identity.

Do not add every package to a config object to make an application look complete. Configure only the infrastructure actually used, and put explicit helper initialization in the appropriate plugin/worker/component owner.

## TypeScript and JavaScript together

A JavaScript default export can use JSDoc `ZeruxConfig`; TypeScript can use `satisfies ZeruxConfig`. Check a nested service against `NonNullable<ZeruxConfig['cache']>` or the corresponding field because the open root type allows custom keys. Individual chapters show both forms and exact option contracts.

Unknown HTTP bodies, environment strings and persisted snapshots still require runtime validation. A valid callback type does not prove the callback authenticates anyone. A successful build does not establish an SMTP, Redis or database connection.

## A small complete application

Follow [complete configuration examples](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-examples.md) for a local SQLite/memory-cache/files setup and a production-shaped PostgreSQL/Redis configuration. These examples choose a narrow set of services rather than relying on unavailable secrets or a generator placeholder. Add protected email/analytics/admin integrations only after their identity, storage and failure policies are defined.

## Reference and troubleshooting

The [configuration reference](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-reference.md) lists the declared root/interface shapes, while each service guide explains the actual consumer, values and lifecycle. Use [troubleshooting](/branch/v0.0.4/zeruxjs/docs/0.0.4/troubleshooting.md) to separate file precedence, module-format, type, environment and infrastructure failures. A root type entry that is not consumed is documented as such instead of being presented as a working switch.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/services.ts](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/zeruxjs/src/bootstrap/services.ts)
