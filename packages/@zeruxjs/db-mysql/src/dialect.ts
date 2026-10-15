import type { SqlDialectDefinition } from "@zeruxjs/db-sql-core";
export const mysqlDialect: SqlDialectDefinition = {
            kind: "mysql",
            quoteIdentifier: (identifier: string) => `\`${identifier.replace(/`/g, "``")}\``,
            placeholder: () => "?",
            functions: {
                LEN: "CHAR_LENGTH",
                NOW: "NOW",
                CURRENT_TIMESTAMP: "CURRENT_TIMESTAMP",
                CURRENT_DATE: "CURRENT_DATE",
                DATE_DIFF: "DATEDIFF"
            },
            supportsReturning: false,
            supportsIfNotExistsIndex: false,
            autoIncrementKeyword: "AUTO_INCREMENT"
        };
