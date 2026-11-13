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
npm install @zeruxjs/db-sql-core@0.0.4
```

This package participates in the runtime's **database** integration. Start with [database configuration](/branch/v0.0.4/zeruxjs/docs/0.0.4/configuration-database.md), which documents `zerux.config.js`, its exact values and the matching TypeScript setup. Runtime setup and standalone factory input are different contracts; do not paste a factory argument under a config key without checking the adapter layer.

## A practical integration workflow

Most applications install a concrete PostgreSQL, MySQL or SQLite adapter and use its manager integration. The SQL core is the lower-level dialect/compiler contract for adapter authors. It accepts a dialect and executor settings; it does not itself install a database server or choose a connection pool. Separate trusted identifier handling from parameter values.

## TypeScript: inputs, results and ownership

```ts
import { createSqlConnector } from '@zeruxjs/db-sql-core';

type Inputs = Parameters<typeof createSqlConnector>;
type Result = Awaited<ReturnType<typeof createSqlConnector>>;
```

`Inputs` is the function's complete argument tuple, including optional parameters. `Result` removes a Promise when the function is asynchronous. These aliases follow the installed declarations; no internal `src`/branch/v0.0.4/`dist` import is required. For a generic factory, keep the concrete call's inferred type when an application needs a narrower result than `ReturnType` preserves. Use `satisfies` or a public option type for configuration literals, and validate unknown request/file data separately.

In a JavaScript application the equivalent editor annotation is `/** @type {Parameters<typeof createSqlConnector>} */` on a matching argument tuple. This provides diagnostics only when JavaScript checking is enabled. It does not validate network data or create a resource automatically. See [strict application setup](/branch/v0.0.4/zeruxjs/docs/0.0.4/typescript.md) for the complete NodeNext checker configuration.

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

| Field                      | Accepted type/value                             | Optional |
| -------------------------- | ----------------------------------------------- | -------- |
| `kind`                     | `string`                                        | No       |
| `quoteIdentifier`          | `(identifier: string) => string`                | No       |
| `placeholder`              | `(index: number) => string`                     | No       |
| `functions`                | `Partial<Record<DatabaseFunctionName, string>>` | No       |
| `supportsReturning`        | `boolean`                                       | Yes      |
| `supportsDdl`              | `boolean`                                       | Yes      |
| `supportsGeneratedKeys`    | `boolean`                                       | Yes      |
| `supportsIfNotExistsIndex` | `boolean`                                       | Yes      |
| `supportsFetch`            | `boolean`                                       | Yes      |
| `ilikeOperator`            | `string`                                        | Yes      |
| `autoIncrementKeyword`     | `string`                                        | No       |

### SqlConnectorOptions

| Field           | Accepted type/value                                                                                                                                         | Optional |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `synchronous`   | `boolean`                                                                                                                                                   | Yes      |
| `executor`      | `(statement: string, params: unknown[], operation: QueryOperation) => MaybePromise<unknown>`                                                                | Yes      |
| `client`        | `{ query?: (statement: string, params?: unknown[]) => MaybePromise<unknown>; execute?: (statement: string, params?: unknown[]) => MaybePromise<unknown>; }` | Yes      |
| `pool`          | `{ query?: (statement: string, params?: unknown[]) => MaybePromise<unknown>; execute?: (statement: string, params?: unknown[]) => MaybePromise<unknown>; }` | Yes      |
| `database`      | `string`                                                                                                                                                    | Yes      |
| `fixedDatabase` | `boolean`                                                                                                                                                   | Yes      |
| `lockDatabase`  | `boolean`                                                                                                                                                   | Yes      |
| `locked`        | `boolean`                                                                                                                                                   | Yes      |

## Direct compilation and runtime guards

`compileSql(dialect, operation)` exposes the same bounded own-data validation used by `createSqlConnector`; no connection is opened. It returns one parameter list per statement, validates all identifiers/enums and rejects unknown clauses and raw expressions independently of facade normalization. See the package README for a public-import example and exact budgets.

NULL equality uses explicit null predicates; empty IN/NOT IN is rejected. Multi-row shapes must match. Nested/subquery/keyset parameters retain lexical numbering. Structured CHECK predicates are supported through database-owned types; DDL literals are validated/encoded instead of losing placeholders. Raw CHECK text, subqueries and unsupported function semantics fail before execution.

Unsupported index guards, RETURNING, DDL/generated-key policies, upsert/conflict clauses, join/order features and pagination combinations are rejected rather than dropped. The README lists the intentionally limited dialect matrix. Backend versions and permissions remain deployment prerequisites. Generated numeric IDs with lost precision fail; bigint SQLite IDs retain their string representation. The compiler owns no native clients, transactions or cleanup of borrowed pools. Native transaction and decimal/time precision acceptance require the actual driver/backend; mocked compilation is not live acceptance.

## Source ownership

The validation module owns bounded own-data snapshots and exact grammar fields; the compiler module owns lexical parameter buffers, supported dialect clauses, DDL literal mode and private native normalization. Each public compile call receives a fresh compiler, and borrowed executors remain host-owned. Neither facade construction nor compilation acquires a connection or supplies disconnect/transaction/cancellation. Trusted dialect callbacks are not sandboxed; SQL/params/results/causes require explicit response sanitization. The package README maps these owners and distinguishes native SQLite/injected-adapter checks from live backend acceptance.


## Public entry points

Manifest reference for `@zeruxjs/db-sql-core@0.0.4`.

```json
{
  "exports": {
    ".": "./dist/index.js"
  },
  "engines": {},
  "dependencies": {
    "@zeruxjs/db": "0.0.4"
  },
  "peerDependencies": {},
  "bin": {}
}
```


## Package README

# @zeruxjs/db-sql-core

Shared parameterized SQL compiler and connector executor for PostgreSQL, MySQL and SQLite. It is an internal library; applications should normally use `@zeruxjs/db` plus the appropriate connector.

`createSqlConnector(dialect, options)` compiles the normalized JSON operation into dialect-specific SQL and normalizes returned row counts and insert IDs. Insert IDs are emitted only for actual `insert` operations, not DDL or updates; SQLite bigint IDs are converted to strings where necessary to preserve precision.

**Trust boundary:** Query _values_ are parameterized. Column/table identifiers are validated upstream by `@zeruxjs/db` and quoted by the dialect. Do not expose unrestricted schema operations or raw SQL to untrusted callers, and use database credentials with least privilege. Each SQL operation executes separately unless the application explicitly manages a native transaction.

**Safety contract:** compiler validates identifiers and runtime operator/function/join/order/index enums independently of TypeScript; SQL CHECK text strings are **rejected**, use a validated structured expression. Column lengths, integer limits and INSERT row shapes are checked. Unsupported RETURNING (notably MySQL) throws rather than being silently ignored. PostgreSQL write results expose `affectedCount` from driver `rowCount`, including zero-row CAS misses. MySQL and SQLite index/drop syntax and SQLite integer primary key autoincrement use engine-specific rules.

Structured connector capability metadata now advertises dialect returning and schema/index subsets. Transactions and cancellation remain unsupported by this generic executor, even when a native pool has those APIs. Normalized DML counters retain exact engine semantics (`counts.affectedMeaning: 'engine'`), including zero; no affected count is inferred from returned rows. See `@zeruxjs/db` for pending/deadline policy and keyset contracts. These capabilities do not imply every schema action is supported by every dialect.

## Direct compiler boundary

`compileSql(dialect, operation)` returns `{statements, params}` without opening a connection. `createSqlConnector` uses the same validation boundary, independently of `@zeruxjs/db` normalization. Input must be own-property JSON data: getters, cycles, prototypes, functions, undefined, nonfinite numbers and unsafe property names are rejected. Inputs are bounded to 8 MiB, depth 32, 20000 nodes and 10000 array entries. Unknown operation/expression/clause fields fail rather than disappearing; in particular upsert/replace/ignore/conflict clauses are deliberately unavailable. Query arrays belong to the database manager, not this single-operation compiler.

Identifiers are validated here and quoted by the trusted dialect callback; aliases/DDL column names are flat identifiers. Operators, function names/arity, joins, ordering, foreign actions, booleans and index methods are checked at runtime. Raw identifier/expression/CHECK text cannot bypass this boundary. Dialect callbacks remain trusted executable code, not a sandbox. The factory snapshots dialect data so later mutation does not change its advertised capabilities. The factory never opens or closes an injected client/pool; the owning connector controls its resources and failure cleanup.

```ts
import { compileSql, type SqlDialectDefinition } from '@zeruxjs/db-sql-core';

const dialect: SqlDialectDefinition = {
  kind: 'pgsql', quoteIdentifier: name => `"${name}"`,
  placeholder: index => `$${index}`, functions: { LEN: 'LENGTH' },
  supportsReturning: true, supportsFetch: true,
  autoIncrementKeyword: 'GENERATED BY DEFAULT AS IDENTITY'
};
const compiled = compileSql(dialect, {
  op: 'update', table: 'jobs', values: { state: 'claimed' },
  where: { and: [
    { field: 'id', operator: 'eq', value: 'example-job' },
    { field: 'revision', operator: 'eq', value: 1 }
  ] }, returning: ['id']
});
// SQL uses $1, $2, $3; values remain in compiled.params[0].
console.log(compiled.statements[0]);
```

Do not log `params` or return complete compilations/results to clients. `SqlCompilation` is owned here; shared operations, structured CHECK predicate types and counts remain owned by `@zeruxjs/db`.

## Deliberate dialect limits

- RETURNING requires `supportsReturning: true`; MySQL remains unsupported. `supportsDdl: false` rejects all schema/index operations and reports them unavailable. `supportsGeneratedKeys: false` rejects auto-increment definitions. Omitted DDL/generated-key flags retain the existing dialect defaults. Generated-key support refers to schema generation, not a promise to retrieve all generated IDs. Driver/server versions and permissions must still support the declared dialect; injected executors do not certify backend features.
- No upsert API or conflict policy is implemented. Unknown `upsert`, `onConflict`, duplicate-key, ignore and replace clauses reject before execution. No transaction/cancellation/native aggregation capability is added by this compiler.
- MySQL index guards (`IF NOT EXISTS`), NULLS ordering, FULL JOIN, ILIKE, expression indexes in this subset, non-BTREE/HASH methods and foreign SET DEFAULT are rejected. Binary `concat` is rejected there because `||` normally means logical OR; use the structured CONCAT function. PostgreSQL/SQLite binary concat uses `||`.
- SQLite RIGHT/FULL joins, ANY/ALL, ILIKE, USING index methods and database create/drop/switch are deliberately unavailable even when a newer SQLite version offers some of them. PostgreSQL database switching and CREATE DATABASE IF NOT EXISTS are unavailable. Database force-drop and unsupported cascade/restart-identity clauses reject. MODIFY COLUMN remains MySQL-only; there is no implied cross-dialect schema migration.
- SQLite's historical truncate compatibility is compiled as DELETE FROM, with its real affected-row count; it does not reset identity or implement PostgreSQL TRUNCATE semantics. Trigger/foreign-key behavior follows DELETE. Restart/cascade flags reject.
- Index guards cannot be silently omitted. FETCH count translates to LIMIT only when no WITH TIES semantics are requested. Supported FETCH WITH TIES requires ordering and emits `ROWS WITH TIES`, following [PostgreSQL SELECT](https://www.postgresql.org/docs/current/sql-select.htm). Conflicting limit/top/fetch specifications reject. Limits include zero (maximum 100000); offsets are 0–1000000, and MySQL/SQLite require a limit for a positive offset. Compound selects with per-arm ordering/pagination are deliberately rejected; no implicit rewrite changes their meaning.
- YEAR/MONTH/DAY and two-argument DATE_DIFF are MySQL-only in this subset. DATE_ADD is unavailable because its interval contract is not defined. SQLite CONCAT and PostgreSQL/SQLite DATE_DIFF are rejected rather than mapped to semantically different functions. CURRENT_DATE/CURRENT_TIMESTAMP are zero-argument SQL keywords; SQLite NOW maps to CURRENT_TIMESTAMP. Supported functions use bounded arity, not arbitrary executable SQL.

## Values, CHECKs and result precision

`eq null`/branch/v0.0.4/`ne null` compile to IS NULL/IS NOT NULL without a parameter. Other direct NULL comparisons reject; use explicit null predicates. IN and NOT IN require a nonempty array (maximum 10000); empty membership remains a validation error. NULL inside a nonempty list keeps native SQL three-valued behavior. Multi-row INSERT requires identical nonempty own column sets; no columns are silently discarded. Aggregate aliases and nested expressions use the same validated identifier boundary. Placeholder numbering follows lexical SQL order across projection values, joins, subqueries, filters, unions and composite keyset predicates; each statement has its own parameter list.

CHECK accepts a structured predicate such as `{field:'amount',operator:'gte',value:0}`, or the existing structured expression/boolean subset. No raw CHECK string or CHECK subquery is accepted. Aggregates and current-time functions are disallowed in CHECK/index expressions. DDL cannot portably bind ordinary query placeholders, so validated CHECK/default/index literals are encoded inline and never discarded from a parameter list. DDL string literals reject control characters/backslashes and double embedded quotes. Query values continue to be bound, including hostile text. These restrictions follow the limited contract, not every engine's expression grammar; [SQLite CHECK](https://www.sqlite.org/lang_createtable.html) also forbids subqueries. Defaults referencing columns, contradictory default/auto-increment definitions and unused column-size options reject. PostgreSQL binary/blob/datetime/double types map to BYTEA/TIMESTAMP/DOUBLE PRECISION; MySQL UUID maps to CHAR(36).

Zero affected counts stay zero. Native integer counters must be safe nonnegative integers. Insert IDs are emitted only for inserts; bigint SQLite IDs become strings, and unsafe numeric generated IDs reject with `UNSAFE_GENERATED_KEY` because lost precision cannot be reconstructed. An error discovered after a write does not roll back that write. RETURNING arrays expose returned rows/count, without inventing affected rows or generated IDs. This is not a guarantee of arbitrary NUMERIC/DECIMAL, timestamp or timezone round-trip precision; those remain driver/application policies.

Focused checks include direct compiler failures, executor outage, injected pool ownership, nested/keyset placeholders and disposable native SQLite CHECK/RETURNING/DELETE behavior when `node:sqlite` is available. PostgreSQL/MySQL backend versions, native transaction behavior and numeric/time precision need separately configured live acceptance; local compilation and injected results do not prove them.

Migration note: callers that relied on MySQL silently discarding index guards must choose an explicit owning migration policy. Analytics already fails closed for numeric backfill when its unique index cannot be verified; its existing `indexes:false,numericUniqueIndexManagedExternally:true` policy is appropriate only after the operator provisions that unique constraint. Optional read-index failures retain their existing degraded status. The compiler never automatically retries with an unguarded CREATE INDEX.

`SqlConnectorOptions.synchronous:true` is an explicit owner contract for synchronous executors. Single- and multi-statement execution rejects thenables without creating an async continuation that could issue later DDL outside a native transaction. SQLite uses this path for its separate `transactionSync` API; it does not enable the shared async transaction capability.

## Implementation and ownership map

`src/validation.ts` owns bounded own-data snapshots and exact clause/list/flag validation. It rejects accessors before reading values and never invokes toJSON. `src/index.ts` owns a fresh per-operation compiler, lexical parameter allocation, explicit DDL literal mode, dialect support guards and native result normalization. Shared operation/count types remain in `@zeruxjs/db`; concrete adapters own pool/session/cancellation behavior.

The compiler snapshots dialect metadata, but quoting/placeholders and executor functions remain trusted executable host code. Root runtime imports require Node. `compileSql` opens nothing, and `createSqlConnector` borrows its native executor without supplying disconnect, transaction or cancellation ownership. Do not add a fake close path or treat it as a tenant authorization boundary. Native results, generated SQL, parameters and original causes remain private until the host sanitizes a response.

The focused suite preserves exact SQL/parameter fixtures and uses disposable native in-memory SQLite for CHECK/RETURNING/keyset/delete behavior. PostgreSQL/MySQL consumers also exercise their injected pinned contracts. These checks do not qualify live engine versions, transactional DDL across dialects or application-specific parser/precision policy.


## Implementation sources

- [packages/@zeruxjs/db-sql-core/README.md](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/db-sql-core/README.md)
- [packages/@zeruxjs/db-sql-core/package.json](https://github.com/zeruxjs/zeruxjs/blob/version/v0.0.4/packages/@zeruxjs/db-sql-core/package.json)
