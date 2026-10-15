import db from "db:something";

const DB_DEMO_TABLE_FALLBACK = "contact_submissions";
export const DB_DEMO_CONNECTION_SLUG = "something";
const IDENTIFIER_CHAR_PATTERN = /[^A-Za-z0-9_]/g;

const isIgnorableIndexError = (error: unknown): boolean => {
    if (!(error instanceof Error)) return false;

    const details = "details" in error && typeof error.details === "object" && error.details !== null
        ? error.details as Record<string, unknown>
        : null;
    const code = typeof details?.code === "string" ? details.code : "";
    const message = error.message.toLowerCase();

    return code === "ER_DUP_KEYNAME" ||
        message.includes("duplicate key name") ||
        message.includes("already exists");
};

/**
 * Title: Demo table name resolver
 * Description: Builds a safe demo table name using the configured DB prefix when available.
 * Global Variables: none
 * @returns Safe table name.
 */
export const getDbDemoTableName = (): string => {
    const rawPrefix = typeof db.options.prefix === "string" ? db.options.prefix : "";
    const safePrefix = rawPrefix.replace(IDENTIFIER_CHAR_PATTERN, "_").replace(/^_+|_+$/g, "");

    return safePrefix ? `${safePrefix}_${DB_DEMO_TABLE_FALLBACK}` : DB_DEMO_TABLE_FALLBACK;
};

/**
 * Title: Demo table bootstrap
 * Description: Creates the demo submissions table and supporting email index when they do not already exist.
 * Global Variables: none
 * @returns Create table result.
 */
export const ensureDbDemoTable = async () => {
    const table = getDbDemoTableName();

    const createTableResult = await db.createTable({
        table,
        ifNotExists: true,
        columns: [
            {
                name: "id",
                type: "integer",
                primary: true,
                autoIncrement: true
            },
            {
                name: "name",
                type: "varchar",
                length: 120,
                notNull: true
            },
            {
                name: "email",
                type: "varchar",
                length: 190,
                notNull: true
            },
            {
                name: "message",
                type: "text",
                notNull: true
            },
            {
                name: "created_at",
                type: "datetime",
                notNull: true,
                default: {
                    kind: "function",
                    name: "CURRENT_TIMESTAMP"
                }
            }
        ]
    });

    try {
        await db.createIndex({
            table,
            name: `${table}_email_idx`,
            columns: ["email"]
        });
    } catch (error) {
        if (!isIgnorableIndexError(error)) {
            throw error;
        }
    }

    return createTableResult;
};

/**
 * Title: Submission input parser
 * Description: Validates and normalizes incoming form input for the DB demo endpoint.
 * Global Variables: none
 * @param input Request body candidate.
 * @returns Normalized submission payload.
 */
export const normalizeDbDemoInput = (
    input: unknown
): { name: string; email: string; message: string; } => {
    const body = typeof input === "object" && input !== null ? input as Record<string, unknown> : {};
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const message = String(body.message ?? "").trim();

    if (name.length < 2) {
        throw new Error("Name must be at least 2 characters long");
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new Error("Email must be a valid email address");
    }

    if (message.length < 5) {
        throw new Error("Message must be at least 5 characters long");
    }

    return {
        name: name.slice(0, 120),
        email: email.slice(0, 190),
        message: message.slice(0, 2000)
    };
};

/**
 * Title: Demo submissions reader
 * Description: Reads the latest demo submissions from the configured database table.
 * Global Variables: none
 * @param limit Maximum rows to fetch.
 * @returns Database select result.
 */
export const listDbDemoSubmissions = async (limit = 20) =>
    db.select({
        table: getDbDemoTableName(),
        columns: ["id", "name", "email", "message", "created_at"],
        orderBy: [
            {
                by: "id",
                direction: "desc"
            }
        ],
        limit
    });

/**
 * Title: Demo DB facade getter
 * Description: Returns the database facade bound to the configured demo connection slug.
 * Global Variables: none
 * @returns Slug-bound database facade.
 */
export const getDbDemoConnection = () => db;
