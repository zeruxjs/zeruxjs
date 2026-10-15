# Package ecosystem review — 2026-10-10

This report records the targeted, source-level audit of the package workspace. It is **not** a certification that each package is production-ready. Dependencies are not installed in the supplied archive; full workspace compile and integration testing remain pending.

## Fixed in this pass

- `@zeruxjs/cache-redis`: reject invalid TTL values before issuing Redis operations.
- `@zeruxjs/db-mongo`: reject MongoDB operator-style predicate fields; convert LIKE patterns into escaped, anchored regular expressions so a user-supplied pattern cannot inject arbitrary regex operators.
- `@zeruxjs/db-mysql`: support clients exposing `query()` rather than `execute()`; replace evaluated dynamic import with standard dynamic import.
- `@zeruxjs/db-pg`: replace dynamically evaluated module import with standard dynamic import.
- `zcli`: use a null-prototype options map and reject prototype-sensitive CLI argument keys.
- `z-dev`: enforce a 1 MiB request body maximum, return 413 for oversized bodies, catch handler exceptions, and parse IPv6 hostnames consistently.
- `zsrv`: disable Windows shell execution in the command helper (commands requiring shell syntax must explicitly invoke a shell).

## Inventory

The workspace includes the following packages; the status means source inventoried only unless it appears above or was updated in an earlier delivery.

- `z-dev` — source inventoried; integration checks pending.
- `zcli` — source inventoried; integration checks pending.
- `zeruxjs` — source inventoried; integration checks pending.
- `zeyro` — source inventoried; integration checks pending.
- `zsrv` — source inventoried; integration checks pending.
- `zuix` — source inventoried; integration checks pending.
- `zwatch` — source inventoried; integration checks pending.
- `zyrojs` — source inventoried; integration checks pending.
- `@zeruxjs/accessibility` — source inventoried; integration checks pending.
- `@zeruxjs/ai` — source inventoried; integration checks pending.
- `@zeruxjs/ai-model` — source inventoried; integration checks pending.
- `@zeruxjs/asset-manager` — source inventoried; integration checks pending.
- `@zeruxjs/auth` — source inventoried; integration checks pending.
- `@zeruxjs/cache` — source inventoried; integration checks pending.
- `@zeruxjs/cache-redis` — source inventoried; integration checks pending.
- `@zeruxjs/db` — source inventoried; integration checks pending.
- `@zeruxjs/db-mongo` — source inventoried; integration checks pending.
- `@zeruxjs/db-mysql` — source inventoried; integration checks pending.
- `@zeruxjs/db-pg` — source inventoried; integration checks pending.
- `@zeruxjs/db-sql-core` — source inventoried; integration checks pending.
- `@zeruxjs/db-sqlite` — source inventoried; integration checks pending.
- `@zeruxjs/feed` — source inventoried; integration checks pending.
- `@zeruxjs/font` — source inventoried; integration checks pending.
- `@zeruxjs/hooks` — source inventoried; integration checks pending.
- `@zeruxjs/lint` — source inventoried; integration checks pending.
- `@zeruxjs/mcp` — source inventoried; integration checks pending.
- `@zeruxjs/media` — source inventoried; integration checks pending.
- `@zeruxjs/performance` — source inventoried; integration checks pending.
- `@zeruxjs/react` — source inventoried; integration checks pending.
- `@zeruxjs/search` — source inventoried; integration checks pending.
- `@zeruxjs/security` — source inventoried; integration checks pending.
- `@zeruxjs/seo` — source inventoried; integration checks pending.
- `@zeruxjs/share` — source inventoried; integration checks pending.
- `@zeruxjs/typescript` — source inventoried; integration checks pending.
- `@zeruxjs/validator` — source inventoried; integration checks pending.
- `@zeruxjs/vue` — source inventoried; integration checks pending.
- `@zeruxjs/zyro` — source inventoried; integration checks pending.

## Follow-up production gates

1. Install workspace dependencies with the project's lockfile and compile each package in dependency order.
2. Exercise database adapters against real PostgreSQL, MySQL, MongoDB and SQLite instances; validate escaping and transaction semantics.
3. Verify Redis cache namespaces: `clear()` currently delegates to `flushDb()` and may affect unrelated tenants if a Redis DB is shared. Use isolated Redis databases until prefix-scoped clearing is implemented.
4. Exercise `zsrv` process launching on Windows and Unix; shell-based Windows commands may require deliberate execution via `cmd.exe`.
5. Perform end-to-end browser and Node testing of ZeruxJS, ZyroJS, Zuix, the devtools and adapters.
6. Audit `zwatch` daemon socket ownership, recovery and event backpressure; audit all package public APIs for version compatibility.
7. Run dependency and license audits, SAST, fuzz tests, and load tests before claiming production certification.

> **Section 31 migration note:** `@zeruxjs/mcp` has been retired; its tool/resource
> APIs now live in `zsrv/src/protocols/mcp` and are exported from `zsrv`.
