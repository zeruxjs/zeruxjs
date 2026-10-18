---
{
  "title": "Shared SQL compiler",
  "description": "Understand the internal SQL translation boundary used by connector adapters.",
  "section": "Packages",
  "order": 7,
  "sources": [
    "packages/@zeruxjs/db-sql-core/README.md",
    "packages/@zeruxjs/db-sql-core/package.json"
  ],
  "related": [
    "packages",
    "plugins"
  ],
  "package": "@zeruxjs/db-sql-core"
}
---

## Intended audience

Applications should use @zeruxjs/db with a concrete connector. This package is primarily for connector implementers who need parameterized SQL generation and normalized execution results.

## Compilation contract

`createSqlConnector(dialect, options)` translates a normalized operation through a dialect. Values become parameters. Identifiers and runtime operator/function/join/order enums are validated and quoted. Arbitrary textual CHECK expressions are rejected in favor of a structured expression.

## Result contract

Write results preserve affected counts; a zero-row update is important for compare-and-swap. Insert IDs are emitted for actual inserts, not DDL or updates. SQLite bigint IDs may be normalized to strings to preserve precision. Dialects have distinct index, autoincrement and RETURNING support.

## Trust and transaction boundary

Parameterized values do not authorize a schema operation. Keep credentials narrow and never expose unrestricted SQL compilation to clients. Each operation executes independently unless a native transaction context is explicitly provided. Adapter changes require verification against each supported real database engine.
