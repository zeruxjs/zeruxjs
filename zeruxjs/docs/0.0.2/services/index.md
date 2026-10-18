# Database, cache and services

Share initialized managers through the application lifecycle.


## Database adapters

@zeruxjs/db provides the shared database layer. Adapter packages cover MongoDB, MySQL, PostgreSQL and SQLite, with db-sql-core shared by SQL adapters. Configure named connections and an explicit default rather than embedding credentials in handlers.

## Cache

The cache configuration selects a connector, options, prefix and default TTL. cache-redis supplies Redis integration. Startup timeout and required control whether missing cache infrastructure blocks startup.

## Managed services

Optional files, email, analytics, tags, reports and queue configurations initialize generation-scoped managers. Plugins access api.service(name); handlers access context.services.get(name). Service methods belong to their package APIs.

## Lifecycle ordering

Database and cache initialize before dependent managers. Resources close in reverse initialization order after prior requests finish. Analytics is best effort; email tracking is opt-in. Use queue workers for durable asynchronous jobs and thread workers for CPU work.


## Implementation sources

- [packages/zeruxjs/src/index.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/index.ts)
- [packages/zeruxjs/src/bootstrap/types.ts](https://github.com/zeruxjs/zeruxjs/blob/master/packages/zeruxjs/src/bootstrap/types.ts)
