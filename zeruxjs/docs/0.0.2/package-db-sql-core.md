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

## Install and select the integration

```sh
npm install @zeruxjs/db-sql-core@0.0.2
```

This package participates in the runtime's **database** integration. Start with [database configuration](/zeruxjs/docs/0.0.2/configuration-database.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Most applications install a concrete PostgreSQL, MySQL or SQLite adapter and use its manager integration. The SQL core is the lower-level dialect/compiler contract for adapter authors. It accepts a dialect and executor settings; it does not itself install a database server or choose a connection pool. Separate trusted identifier handling from parameter values.

## TypeScript: inputs, results and ownership

```ts
import { createSqlConnector } from '@zeruxjs/db-sql-core';

type Inputs = Parameters<typeof createSqlConnector>;
type Result = Awaited<ReturnType<typeof createSqlConnector>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createSqlConnector>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/zeruxjs/docs/0.0.2/typescript.md) for the complete NodeNext checker configuration.

## Failure modes and resource lifetime

Keep dialect placeholder generation and result normalization consistent with the real executor. Do not interpolate user values into SQL to work around an unsupported operation. DDL capabilities, returning support and transaction ownership differ by adapter. If extending the core, verify generated SQL and behavior against the actual driver instead of only comparing SQL strings.

## Verify before deploying

- Exercise the example with the actual owning runtime/browser, not only an imported module.
- Test one invalid input and the relevant unavailable/denied dependency path; do not turn those into a silent success.
- Confirm teardown leaves no owned listeners, timers, connections or stale per-user state.
- Check the production entry point and installed export map; a workspace checkout can contain features not yet published to npm.

## Public option and data contracts

These tables list fields declared directly on the named public contract. Referenced/inherited types retain their own declarations; optional does not imply a default value. Use the lifecycle and configuration chapters above for actual initialization behavior.

### SqlDialectDefinition

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `kind` | `string` | No |
| `quoteIdentifier` | `string` | No |
| `placeholder` | `string` | No |
| `functions` | `Partial<Record<DatabaseFunctionName, string>>` | No |
| `supportsReturning` | `boolean` | Yes |
| `supportsIfNotExistsIndex` | `boolean` | Yes |
| `supportsFetch` | `boolean` | Yes |
| `ilikeOperator` | `string` | Yes |
| `autoIncrementKeyword` | `string` | No |

### SqlConnectorOptions

| Field | Accepted type/value | Optional |
| --- | --- | --- |
| `executor` | `(statement: string, params: unknown[], operation: QueryOperation) => MaybePromise<unknown>` | Yes |
| `client` | `{ query?: (statement: string, params?: unknown[]) => MaybePromise<unknown>; execute?: (statement: string, params?: unknown[]) => MaybePromise<unknown>; }` | Yes |
| `pool` | `{ query?: (statement: string, params?: unknown[]) => MaybePromise<unknown>; execute?: (statement: string, params?: unknown[]) => MaybePromise<unknown>; }` | Yes |
| `database` | `string` | Yes |
| `fixedDatabase` | `boolean` | Yes |
| `lockDatabase` | `boolean` | Yes |
| `locked` | `boolean` | Yes |


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
