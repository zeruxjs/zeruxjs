# @zeruxjs/db-sql-core

Shared parameterized SQL compiler and connector executor for PostgreSQL, MySQL and SQLite. It is an internal library; applications should normally use `@zeruxjs/db` plus the appropriate connector.

`createSqlConnector(dialect, options)` compiles the normalized JSON operation into dialect-specific SQL and normalizes returned row counts and insert IDs. Insert IDs are emitted only for actual `insert` operations, not DDL or updates; SQLite bigint IDs are converted to strings where necessary to preserve precision.

**Trust boundary:** Query *values* are parameterized. Column/table identifiers are validated upstream by `@zeruxjs/db` and quoted by the dialect. Do not expose unrestricted schema operations or raw SQL to untrusted callers, and use database credentials with least privilege. Each SQL operation executes separately unless the application explicitly manages a native transaction.

**Section 74 safety contract:** compiler validates identifiers and runtime operator/function/join/order/index enums independently of TypeScript; SQL CHECK text strings are **rejected**, use a validated structured expression. Column lengths, integer limits and INSERT row shapes are checked. Unsupported RETURNING (notably MySQL) throws rather than being silently ignored. PostgreSQL write results expose `affectedCount` from driver `rowCount`, including zero-row CAS misses. MySQL and SQLite index/drop syntax and SQLite integer primary key autoincrement use engine-specific rules.
