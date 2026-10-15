# Section 34 — Cache & Database Reliability

Baseline: Section 33 full project ZIP. This section moves from ZCLI/Zeyro to the database and cache subsystem.

## Delivered

- `@zeruxjs/cache`: built-in memory/LRU/TTL helper; safe per-prefix clearing; mapped bulk reads; conditional writes; in-process coalesced `remember`; injected adapter factory; safer counter validation.
- `@zeruxjs/cache-redis`: modular Redis client, JSON codec and TTL validation; prefix-scoped SCAN deletion; explicit opt-in for dangerous FLUSHDB; Redis atomic counters and SET NX/XX; injected-client ownership semantics.
- `@zeruxjs/db-sqlite`: removed compiled sibling imports and CommonJS-only loading; supports Node SQLite and optional better-sqlite3; connection ownership/cleanup, parameterized CRUD and accurate DML result metadata.
- `@zeruxjs/db-pg`, `@zeruxjs/db-mysql`: separate pool and dialect modules, correct public dependency import, safer custom client/pool behavior, and MySQL tuple unwrapping.
- `@zeruxjs/db-sql-core`: corrected insertedIds only for inserts and large SQLite row IDs.

## Validation / boundaries

Focused TypeScript check and Node runtime integration tests cover memory/Redis cache behavior, SQLite CRUD, and injected PG/MySQL adapters. No live remote Redis/Postgres/MySQL service was used; injected clients simulate their documented interfaces. Do not interpret this as production load/security certification. SQLite is tested with Node's built-in runtime; alternative native driver and OS behavior remain outside this test environment.

Cache clearing with a prefix is intentionally stricter than before; an adapter lacking clearPrefix now throws rather than clearing every key. Redis FLUSHDB requires explicit authorization. Existing deployment files and unrelated packages are unchanged.
