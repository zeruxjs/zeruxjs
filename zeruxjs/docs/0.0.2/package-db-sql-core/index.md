# Shared SQL compiler

Understand the internal SQL translation boundary used by connector adapters.


## Intended audience

Applications should use @zeruxjs/db with a concrete connector. This package is primarily for connector implementers who need parameterized SQL generation and normalized execution results.

## Compilation contract

`createSqlConnector(dialect, options)` translates a normalized operation through a dialect. Values become parameters. Identifiers and runtime operator/function/join/order enums are validated and quoted. Arbitrary textual CHECK expressions are rejected in favor of a structured expression.

## Result contract

Write results preserve affected counts; a zero-row update is important for compare-and-swap. Insert IDs are emitted for actual inserts, not DDL or updates. SQLite bigint IDs may be normalized to strings to preserve precision. Dialects have distinct index, autoincrement and RETURNING support.

## Trust and transaction boundary

Parameterized values do not authorize a schema operation. Keep credentials narrow and never expose unrestricted SQL compilation to clients. Each operation executes independently unless a native transaction context is explicitly provided. Adapter changes require verification against each supported real database engine.


## Public entry points

Manifest reference for `@zeruxjs/db-sql-core@0.0.2`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/db": "0.0.2"
  },
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/db-sql-core

Shared parameterized SQL compiler and connector executor for PostgreSQL, MySQL and SQLite. It is an internal library; applications should normally use `@zeruxjs/db` plus the appropriate connector.

`createSqlConnector(dialect, options)` compiles the normalized JSON operation into dialect-specific SQL and normalizes returned row counts and insert IDs. Insert IDs are emitted only for actual `insert` operations, not DDL or updates; SQLite bigint IDs are converted to strings where necessary to preserve precision.

**Trust boundary:** Query *values* are parameterized. Column/table identifiers are validated upstream by `@zeruxjs/db` and quoted by the dialect. Do not expose unrestricted schema operations or raw SQL to untrusted callers, and use database credentials with least privilege. Each SQL operation executes separately unless the application explicitly manages a native transaction.

**Section 74 safety contract:** compiler validates identifiers and runtime operator/function/join/order/index enums independently of TypeScript; SQL CHECK text strings are **rejected**, use a validated structured expression. Column lengths, integer limits and INSERT row shapes are checked. Unsupported RETURNING (notably MySQL) throws rather than being silently ignored. PostgreSQL write results expose `affectedCount` from driver `rowCount`, including zero-row CAS misses. MySQL and SQLite index/drop syntax and SQLite integer primary key autoincrement use engine-specific rules.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Implementation sources

- [packages/@zeruxjs/db-sql-core/README.md](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/db-sql-core/README.md)
- [packages/@zeruxjs/db-sql-core/package.json](https://github.com/zeruxjs/zeruxjs/blob/master/packages/@zeruxjs/db-sql-core/package.json)
