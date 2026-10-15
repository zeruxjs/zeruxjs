import {
    DB_DEMO_CONNECTION_SLUG,
    ensureDbDemoTable,
    getDbDemoConnection,
    getDbDemoTableName,
    listDbDemoSubmissions,
    normalizeDbDemoInput
} from "../../../db-demo.ts";

/**
 * Title: Demo submission list endpoint
 * Description: Returns the latest database-backed demo submissions after ensuring the table exists.
 * Global Variables: none
 * @returns Demo submission payload.
 */
export const GET = async () => {
    const db = getDbDemoConnection();
    await ensureDbDemoTable();
    const result = await listDbDemoSubmissions(20);

    return {
        ok: true,
        connection: {
            slug: DB_DEMO_CONNECTION_SLUG,
            name: db.name,
            connector: db.connector
        },
        table: getDbDemoTableName(),
        rows: result.rows ?? [],
        rowCount: result.rowCount ?? 0
    };
};

/**
 * Title: Demo submission create endpoint
 * Description: Validates JSON input, ensures the table exists, stores a submission, and returns the latest rows.
 * Global Variables: none
 * @param context Zerux request context.
 * @returns Insert result with refreshed rows.
 */
export const POST = async ({ body }: { body: unknown; }) => {
    const db = getDbDemoConnection();
    let submission: { name: string; email: string; message: string; };
    try {
        submission = normalizeDbDemoInput(body);
    } catch (error) {
        return {
            ok: false,
            message: error instanceof Error ? error.message : "Invalid payload"
        };
    }

    await ensureDbDemoTable();

    const insertResult = await db.insert({
        table: getDbDemoTableName(),
        values: submission
    });

    const listResult = await listDbDemoSubmissions(20);

    return {
        ok: true,
        connection: {
            slug: DB_DEMO_CONNECTION_SLUG,
            name: db.name,
            connector: db.connector
        },
        insertedIds: insertResult.insertedIds ?? [],
        affectedCount: insertResult.affectedCount ?? 0,
        rows: listResult.rows ?? []
    };
};

export const middleware = ["request-context", "trace-runtime"];
