---
{
  "title": "Application configuration handbook",
  "description": "Choose the correct runtime setup, inspect every option and verify a complete typed application.",
  "section": "Configuration",
  "order": 0,
  "sources": [
    "packages/zeruxjs/src/index.ts",
    "packages/zeruxjs/src/bootstrap/services.ts"
  ],
  "related": [
    "zerux-config",
    "configuration-examples",
    "typescript",
    "configuration-reference"
  ]
}
---

## Configure by responsibility

Start with the application's owning process and the feature you need. `zerux.config.js`/`.ts` is server startup input. Some packages participate in managed service startup; other packages are explicit factories or browser helpers. A property accepted by an open TypeScript type is not proof of a runtime consumer.

| Responsibility | Configuration chapter | What it establishes |
| --- | --- | --- |
| Config file/export/precedence | [zerux.config.js](zerux-config.md) | Which module is loaded and when |
| Paths, modules and environment | [Structure](configuration-structure.md) | Relative discovery paths and environment timing |
| Listener and hosts | [Server](configuration-server.md) | Actual CLI/config precedence and host policy |
| Named databases/adapters | [Database](configuration-database.md) | Connection slugs, default manager and ownership |
| Memory/Redis caching | [Cache](configuration-cache.md) | Adapter, namespace, TTL and required policy |
| Local/S3 object stores | [Files](configuration-files.md) | Store drivers, access limits and private roots |
| SMTP, inbound and campaigns | [Email](configuration-email.md) | Account setup and independent opt-in features |
| Internal events and collector | [Analytics](configuration-analytics.md) | Database binding and bounded ingestion |
| Browser/server event destinations | [Tags](configuration-tags.md) | Consent, shared stores and protected administration |
| Charts/studio | [Reports](configuration-reports.md) | Authorization, tenant scope and data coverage |
| Durable job processing | [Queue](configuration-queue.md) | Redis, named producers/workers and retries |
| Lifecycle/thread work | [Workers](configuration-workers.md) | Pool defaults and task lifetime |
| RPC/MCP and other protocols | [Protocols](configuration-protocols.md) | Registration, authorization and body/origin limits |
| Server/browser appearance helpers | [Theme](configuration-theme.md) | Mode/cookie/script defaults and compatibility |
| Login/request enforcement | [Auth/security](configuration-auth-security.md) | Explicit setup and current automatic-integration limits |

## Follow a complete setup sequence

1. Create a minimal ESM application and one working route using [installation](installation.md).
2. Add strict checking from the [TypeScript guide](typescript.md), even if production output is bundled/transpiled separately.
3. Configure paths and allowed hosts. Keep private environment, database and upload paths outside public assets.
4. Enable one service and its actual prerequisites. Confirm readiness and perform one real operation before adding a dependent service.
5. Test invalid input, missing infrastructure and shutdown. Choose required/degraded behavior intentionally.
6. Build the production artifact and repeat the request with the deployment environment and identity.

Do not add every package to a config object to make an application look complete. Configure only the infrastructure actually used, and put explicit helper initialization in the appropriate plugin/worker/component owner.

## TypeScript and JavaScript together

A JavaScript default export can use JSDoc `ZeruxConfig`; TypeScript can use `satisfies ZeruxConfig`. Check a nested service against `NonNullable<ZeruxConfig['cache']>` or the corresponding field because the open root type allows custom keys. Individual chapters show both forms and exact option contracts.

Unknown HTTP bodies, environment strings and persisted snapshots still require runtime validation. A valid callback type does not prove the callback authenticates anyone. A successful build does not establish an SMTP, Redis or database connection.

## A small complete application

Follow [complete configuration examples](configuration-examples.md) for a local SQLite/memory-cache/files setup and a production-shaped PostgreSQL/Redis configuration. These examples choose a narrow set of services rather than relying on unavailable secrets or a generator placeholder. Add protected email/analytics/admin integrations only after their identity, storage and failure policies are defined.

## Reference and troubleshooting

The [configuration reference](configuration-reference.md) lists the declared root/interface shapes, while each service guide explains the actual consumer, values and lifecycle. Use [troubleshooting](troubleshooting.md) to separate file precedence, module-format, type, environment and infrastructure failures. A root type entry that is not consumed is documented as such instead of being presented as a working switch.
