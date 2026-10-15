# @zeruxjs/db-sql-core

Shared parameterized SQL compiler and connector executor for PostgreSQL, MySQL and SQLite. It is an internal library; applications should normally use `@zeruxjs/db` plus the appropriate connector.

`createSqlConnector(dialect, options)` compiles the normalized JSON operation into dialect-specific SQL and normalizes returned row counts and insert IDs. Insert IDs are emitted only for actual `insert` operations, not DDL or updates; SQLite bigint IDs are converted to strings where necessary to preserve precision.

**Trust boundary:** Query *values* are parameterized. Column/table identifiers are validated upstream by `@zeruxjs/db` and quoted by the dialect. Do not expose unrestricted schema operations or raw SQL to untrusted callers, and use database credentials with least privilege. Each SQL operation executes separately unless the application explicitly manages a native transaction.
