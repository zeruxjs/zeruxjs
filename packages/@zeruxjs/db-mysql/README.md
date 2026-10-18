# @zeruxjs/db-mysql

MySQL JSON-query connector using parameterized `?` placeholders and `mysql2/promise` (loaded only when needed).

```ts
import { createConnector } from '@zeruxjs/db-mysql';
const mysql = await createConnector({host:'localhost', user:'app', database:'demo', connectionLimit:10});
await mysql.disconnect();
```

Accepts injected `client`, `pool`, or `executor`. MySQL2-style `[rows, fields]` tuples are unwrapped before result normalization, avoiding falsely treating metadata as data rows. The adapter tracks whether it created the pool and never closes an externally owned pool. SQL statements are built by `@zeruxjs/db-sql-core` with placeholders rather than interpolating values. SQL DDL and multi-operation pipelines are not automatically atomic; use the underlying client for transactions and migrations.

## Release 0.0.2

Prepared to validate npm trusted publishing through GitHub Actions.


## Release 0.0.3

Synchronized ecosystem release, including Zuixs CSS-entry support and documentation updates. Existing placeholder packages retain their documented limitations.
