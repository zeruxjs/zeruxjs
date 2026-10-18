# Tenant data and migration boundaries

Bind verified tenant identity to query scope and keep migration atomicity explicit.


## Identity before data selection

Resolve the caller through trusted authentication and membership. A submitted tenant ID, host prefix or role string is a request claim, not proof of permission. hasTenantPermission/requireTenantPermission enforce exact explicit scopes on a previously validated principal; they do not verify that principal themselves.

## Tenant facade

createTenantDatabaseFacade receives a base database facade, tenantId, allowlisted logical-to-physical tables and an optional tenant column. It exposes only scoped select/insert/update/delete and rejects joins, unions, subqueries, cross-database routes and tenant-field changes.

Construct the facade in trusted server code after checking membership. Do not accept the table mapping from the request. A narrow facade is preferable to exposing the entire database manager as a generic JSON query endpoint.

## Beyond rows

Tenant isolation also applies to cache keys, file storage prefixes, search documents, queue IDs, report definition stores and analytics sites. Enforcing a row filter while sharing an unrestricted report definition document or search index can still leak information. Review each subsystem's boundary rather than assuming one tenant helper protects the whole application.

## Versioned writes

Cross-replica compare-and-swap depends on an atomic conditional write and reliable affected-row counts. A successful SQL execution with zero updated rows is a conflict, not success. Do not replace a durable CAS adapter with a read-then-write object mutation guarded only by a local mutex.

## Migrations

The migration runner checks ordered IDs, checksums/drift and reverse approvals. The host must provide exclusivity and a transaction-pinned journal/operation context. A transaction name or JavaScript callback does not create database atomicity when the underlying statements use different pooled connections.

Some DDL is not transactionally reversible on every engine. Review actual driver/engine capabilities, back up beforehand and stage forward-compatible changes for rolling deployments. Do not run privileged migration routes as anonymous HTTP handlers.

## Recovery

Test restoration on the real engine and storage layout. SQLite live backup is distinct from copying an active WAL file. Queue and email state may reference database records, so a partial restore needs a reconciliation plan. Keep an operator audit trail for administrative migrations, retention and uncertain-delivery resolution.


## Implementation sources

- [packages/@zeruxjs/db/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/db/README.md)
- [packages/@zeruxjs/auth/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/auth/README.md)
- [packages/@zeruxjs/db-sql-core/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/db-sql-core/README.md)
