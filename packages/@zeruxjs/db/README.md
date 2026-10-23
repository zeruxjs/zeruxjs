# @zeruxjs/db

JSON-structured database operations, named connections and connector lifecycle management for ZeruxJS or standalone Node.js applications. Drivers are provided by `@zeruxjs/db-mysql`, `@zeruxjs/db-pg`, `@zeruxjs/db-sqlite` and `@zeruxjs/db-mongo`.

Import `createDatabaseManager` for an explicit manager, or `configureDatabaseManager` with the `db`/`query` convenience exports for the active manager. Connector capabilities differ; inspect the adapter README before relying on a database-specific operation. Tenant facades and migration runners are explicit opt-in APIs.

## Lifecycle and safety

`createDatabaseManager(config)` connects each connector sequentially; an initialization failure now disconnects already-created connections. Always call `await manager.disconnect()` on application shutdown (idempotent). Further queries after disconnect fail closed. Query result references are own-property only and cannot traverse prototypes. Connector package names must be package specifiers, not user-provided arbitrary file paths. Query JSON is size/depth bounded. Array queries are **not automatically transactions**; use native connector transactions where atomicity is required.

## Tenant and migration APIs

`createTenantDatabaseFacade(base, {tenantId, tables: {logical:physical}, tenantColumn?})` exposes only tenant-bound select/insert/update/delete. It rejects joins, unions, subqueries, cross-database routes, nonallowlisted tables and tenant-field changes. Construct it **only** from a server-verified principal, never a query parameter. `createDatabaseMigrationRunner(migrations,{transaction})` requires an actual exclusive and transaction-pinned host implementation for both journal and operations. It checks ordered IDs and SHA-256 drift and requires approval for reverse migrations.  This contract does not automatically provide native transactions for any driver.
