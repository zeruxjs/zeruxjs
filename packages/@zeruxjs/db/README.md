
## Lifecycle and safety

`createDatabaseManager(config)` connects each connector sequentially; an initialization failure now disconnects already-created connections. Always call `await manager.disconnect()` on application shutdown (idempotent). Further queries after disconnect fail closed. Query result references are own-property only and cannot traverse prototypes. Connector package names must be package specifiers, not user-provided arbitrary file paths. Query JSON is size/depth bounded. Array queries are **not automatically transactions**; use native connector transactions where atomicity is required.
