import fs from "node:fs";
import path from "node:path";

import type { ZeruxConfig } from "../index.js";
import { register, unregister, getLoaderService } from "../loader/registry.js";

type DatabaseModuleNamespace = {
    default?: unknown;
    db?: unknown;
    query?: unknown;
    createDb?: unknown;
    dropDb?: unknown;
    switchDB?: unknown;
    createTable?: unknown;
    dropTable?: unknown;
    alterTable?: unknown;
    turcunateTable?: unknown;
    createIndex?: unknown;
    dropIndex?: unknown;
    insert?: unknown;
    select?: unknown;
    update?: unknown;
    delete?: unknown;
    dbAccess?: unknown;
    configureDatabaseManager?: (config: Record<string, unknown>) => Promise<{
        connectionSlugs: string[];
        getConnectionFacade(slug?: string): Record<string, unknown>;
    }>;
    createDatabaseManager?: (config: Record<string, unknown>) => Promise<{
        connectionSlugs: string[];
        getConnectionFacade(slug?: string): Record<string, unknown>;
    }>;
    setActiveDatabaseManager?: (manager: unknown) => void;
};

const DB_EXPORT_KEYS = [
    "db",
    "query",
    "createDb",
    "dropDb",
    "switchDB",
    "createTable",
    "dropTable",
    "alterTable",
    "turcunateTable",
    "createIndex",
    "dropIndex",
    "insert",
    "select",
    "update",
    "delete",
    "dbAccess"
] as const;

const DB_FACADE_EXPORT_KEYS = [
    "slug",
    "name",
    "connector",
    "options",
    "query",
    "createDb",
    "dropDb",
    "switchDB",
    "createTable",
    "dropTable",
    "alterTable",
    "turcunateTable",
    "createIndex",
    "dropIndex",
    "insert",
    "select",
    "update",
    "delete",
    "native"
] as const;

const getDbVirtualDir = () => path.join(process.cwd(), `.${getLoaderService()}`, "virtual", "db");
const RESERVED_EXPORT_NAMES = new Set(["delete"]);

const ensureVirtualDbDir = () => {
    fs.mkdirSync(getDbVirtualDir(), { recursive: true });
};

const writeVirtualDbModule = (fileName: string, source: string) => {
    ensureVirtualDbDir();
    fs.writeFileSync(path.join(getDbVirtualDir(), fileName), source, "utf8");
};

const writeVirtualDbTypes = (fileName: string, source: string) => {
    ensureVirtualDbDir();
    fs.writeFileSync(path.join(getDbVirtualDir(), fileName), source, "utf8");
};

const appendExportBinding = (lines: string[], exportName: string, expression: string) => {
    if (RESERVED_EXPORT_NAMES.has(exportName)) {
        const localName = `__${getLoaderService()}_${exportName}`;
        lines.push(`const ${localName} = ${expression};`);
        lines.push(`export { ${localName} as ${exportName} };`);
        return;
    }

    lines.push(`export const ${exportName} = ${expression};`);
};

const appendExportDeclaration = (lines: string[], exportName: string, typeExpression: string) => {
    if (RESERVED_EXPORT_NAMES.has(exportName)) {
        const localName = `__${getLoaderService()}_${exportName}`;
        lines.push(`declare const ${localName}: ${typeExpression};`);
        lines.push(`export { ${localName} as ${exportName} };`);
        return;
    }

    lines.push(`export const ${exportName}: ${typeExpression};`);
};

const createDefaultDbModuleSource = (managerPackage: string) => {
    const lines = [
        `import managerModule from ${JSON.stringify(managerPackage)};`,
        `import * as managerExports from ${JSON.stringify(managerPackage)};`,
        "export default managerModule;"
    ];

    DB_EXPORT_KEYS.forEach((key) => {
        appendExportBinding(lines, key, `managerExports[${JSON.stringify(key)}]`);
    });

    return lines.join("\n");
};

const createDefaultDbModuleTypes = (): string => {
    const lines = [
        "import type * as DatabaseModule from \"@zeruxjs/db\";",
        "declare const db: typeof import(\"@zeruxjs/db\").default;",
        "export default db;"
    ];

    DB_EXPORT_KEYS.forEach((key) => {
        appendExportDeclaration(lines, key, `typeof DatabaseModule[${JSON.stringify(key)}]`);
    });

    return lines.join("\n");
};

const createSlugDbModuleSource = (managerPackage: string, slug: string) => {
    const lines = [
        `import { getActiveDatabaseManager } from ${JSON.stringify(managerPackage)};`,
        `const db = getActiveDatabaseManager().getConnectionFacade(${JSON.stringify(slug)});`,
        "export default db;",
        "export { db };"
    ];

    DB_FACADE_EXPORT_KEYS.forEach((key) => {
        appendExportBinding(lines, key, `db[${JSON.stringify(key)}]`);
    });

    return lines.join("\n");
};

const createSlugDbModuleTypes = (): string => {
    const lines = [
        "import type { DatabaseFacade } from \"@zeruxjs/db\";",
        "declare const db: DatabaseFacade;",
        "export default db;",
        "export { db };"
    ];

    DB_FACADE_EXPORT_KEYS.forEach((key) => {
        appendExportDeclaration(lines, key, `DatabaseFacade[${JSON.stringify(key)}]`);
    });

    return lines.join("\n");
};

/**
 * Title: Database runtime bootstrap
 * Description: Initializes the configured connector manager and removes raw DB credentials from runtime config.
 * Global Variables: none
 * @param config Zerux config object loaded for the current application.
 * @returns Initialized manager or null when no database config exists.
 */
export const initializeDatabaseRuntime = async (
    config: ZeruxConfig
): Promise<unknown | null> => {
    const managerPackage = typeof config.connectorManager === "string"
        ? config.connectorManager
        : "@zeruxjs/db";
    const dbConfig = config.db ?? config.database;

    delete config.db;
    delete config.database;
    delete config.connectorManager;

    unregister("db");

    if (!dbConfig || typeof dbConfig !== "object") {
        return null;
    }

    const moduleValue = await import(managerPackage) as DatabaseModuleNamespace;
    const configure = moduleValue.configureDatabaseManager ?? moduleValue.createDatabaseManager;

    if (typeof configure !== "function") {
        throw new Error(`[zerux database] Connector manager "${managerPackage}" does not export a manager factory`);
    }

    const manager = await configure(dbConfig as Record<string, unknown>);
    if (moduleValue.setActiveDatabaseManager) {
        moduleValue.setActiveDatabaseManager(manager);
    }

    writeVirtualDbModule("default.mjs", createDefaultDbModuleSource(managerPackage));
    writeVirtualDbTypes("default.d.ts", createDefaultDbModuleTypes());

    for (const slug of manager.connectionSlugs as string[]) {
        writeVirtualDbModule(`${slug}.mjs`, createSlugDbModuleSource(managerPackage, slug));
        writeVirtualDbTypes(`${slug}.d.ts`, createSlugDbModuleTypes());
    }

    register("db", (identifier) => {
        if (!identifier) {
            const exportsObject = Object.fromEntries(
                DB_EXPORT_KEYS
                    .filter((key) => moduleValue[key] !== undefined)
                    .map((key) => [key, moduleValue[key]])
            );

            return {
                default: moduleValue.default ?? moduleValue.db,
                ...exportsObject
            };
        }

        const facade = manager.getConnectionFacade(identifier);
        return {
            default: facade,
            db: facade,
            ...facade
        };
    });

    return manager;
};
