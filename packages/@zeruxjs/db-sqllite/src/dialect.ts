import type { SqlDialectDefinition } from "@zeruxjs/db-sql-core";
export const sqliteDialect: SqlDialectDefinition = {
    kind: "sqlite",
    quoteIdentifier: identifier => `"${identifier.replace(/"/g, '""')}"`,
    placeholder: () => "?",
    functions: { LEN: "LENGTH", NOW: "CURRENT_TIMESTAMP", CURRENT_TIMESTAMP: "CURRENT_TIMESTAMP", CURRENT_DATE: "CURRENT_DATE", DATE_DIFF: "JULIANDAY" },
    supportsReturning: true,
    supportsIfNotExistsIndex: true,
    autoIncrementKeyword: "AUTOINCREMENT"
};
