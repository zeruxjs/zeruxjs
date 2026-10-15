import type {
    DatabaseConnectorFactory,
    DatabaseErrorShape,
    DatabaseManagerConfig,
    JsonValue,
    MaybePromise,
    NormalizedConnectionConfig,
    QueryOperation,
    ResultReferenceToken
} from "./types.js";

const IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]*(\.[A-Za-z_][A-Za-z0-9_$]*)*$/;

/**
 * Title: Runtime promise detection
 * Description: Detects promise-like values without forcing async wrappers over sync connectors.
 * Global Variables: none
 * @param value Potentially async value.
 * @returns True when the value behaves like a promise.
 */
export const isPromiseLike = <T>(value: MaybePromise<T>): value is Promise<T> =>
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as Promise<T>).then === "function";

/**
 * Title: MaybePromise mapper
 * Description: Applies a mapper while preserving synchronous execution when possible.
 * Global Variables: none
 * @param value Source value.
 * @param mapper Mapper to apply.
 * @returns Mapped sync or async value.
 */
export const mapMaybePromise = <T, U>(
    value: MaybePromise<T>,
    mapper: (input: T) => U
): MaybePromise<U> => (isPromiseLike(value) ? value.then(mapper) : mapper(value));

/**
 * Title: Async reducer
 * Description: Reduces values while allowing each iteration to be sync or async.
 * Global Variables: none
 * @param items Items to reduce.
 * @param initial Initial accumulator.
 * @param reducer Reducer function.
 * @returns Final accumulator.
 */
export const reduceMaybePromise = <T, U>(
    items: T[],
    initial: U,
    reducer: (accumulator: U, item: T, index: number) => MaybePromise<U>
): MaybePromise<U> => {
    let current: MaybePromise<U> = initial;

    items.forEach((item, index) => {
        current = mapMaybePromise(current, (accumulator) => reducer(accumulator, item, index)) as MaybePromise<U>;
    });

    return current;
};

/**
 * Title: Database error creator
 * Description: Builds a consistent error payload for all abstraction failures.
 * Global Variables: none
 * @param error Partial error information.
 * @returns Normalized Error instance.
 */
export const createDatabaseError = (error: DatabaseErrorShape): Error & { details: DatabaseErrorShape; } => {
    const instance = new Error(error.message) as Error & { details: DatabaseErrorShape; };
    instance.name = "ZeruxDatabaseError";
    instance.details = error;
    return instance;
};

/**
 * Title: Identifier assertion
 * Description: Validates a user supplied identifier to reduce injection risk before connector translation.
 * Global Variables: none
 * @param value Identifier value.
 * @param label Field label for error messages.
 * @returns Sanitized identifier.
 */
export const assertIdentifier = (value: string, label: string): string => {
    if (typeof value !== "string" || value.trim() === "") {
        throw createDatabaseError({
            code: "INVALID_IDENTIFIER",
            message: `${label} must be a non-empty identifier`
        });
    }

    if (!IDENTIFIER_PATTERN.test(value)) {
        throw createDatabaseError({
            code: "INVALID_IDENTIFIER",
            message: `${label} contains unsupported characters`,
            details: { value }
        });
    }

    return value;
};

/**
 * Title: Config normalization
 * Description: Normalizes manager config, supports compatibility keys, and validates the connection collection.
 * Global Variables: none
 * @param config Raw database manager config.
 * @returns Validated manager config.
 */
export const normalizeManagerConfig = (
    config: DatabaseManagerConfig | undefined
): { defaultSlug: string; connections: NormalizedConnectionConfig[]; } => {
    const connections = (config?.connections ?? config?.connection ?? []).map((entry) => {
        const connector = entry.connector ?? entry.connecter;
        if (!connector) {
            throw createDatabaseError({
                code: "INVALID_CONNECTION",
                message: `Database connection "${entry.slug || entry.name || "unknown"}" is missing a connector package`
            });
        }

        return {
            name: String(entry.name || "").trim(),
            slug: assertIdentifier(String(entry.slug || "").trim(), "Database slug"),
            connector: normalizeConnectorPackageName(String(connector).trim()),
            options: typeof entry.options === "object" && entry.options !== null ? { ...entry.options } : {}
        };
    });

    if (connections.length === 0) {
        throw createDatabaseError({
            code: "MISSING_CONNECTIONS",
            message: "At least one database connection must be configured"
        });
    }

    const seen = new Set<string>();
    connections.forEach((connection) => {
        if (!connection.name) {
            throw createDatabaseError({
                code: "INVALID_CONNECTION",
                message: `Database connection "${connection.slug}" is missing a name`
            });
        }

        if (seen.has(connection.slug)) {
            throw createDatabaseError({
                code: "DUPLICATE_CONNECTION",
                message: `Database slug "${connection.slug}" must be unique`
            });
        }

        seen.add(connection.slug);
    });

    const defaultSlug = config?.default
        ? assertIdentifier(config.default, "Default database slug")
        : connections.length === 1
            ? connections[0].slug
            : "";

    if (!defaultSlug) {
        throw createDatabaseError({
            code: "MISSING_DEFAULT_CONNECTION",
            message: "A default database connection is required when multiple connections are configured"
        });
    }

    if (!connections.some((connection) => connection.slug === defaultSlug)) {
        throw createDatabaseError({
            code: "UNKNOWN_DEFAULT_CONNECTION",
            message: `Configured default database "${defaultSlug}" does not exist`
        });
    }

    return { defaultSlug, connections };
};

/**
 * Title: Connector package normalization
 * Description: Preserves compatibility with historical package names and spelling mistakes.
 * Global Variables: none
 * @param value Connector package name.
 * @returns Normalized connector package name.
 */
export const normalizeConnectorPackageName = (value: string): string => {
    if (value === "@zeruxjs/db-sqllite") {
        return "@zeruxjs/db-sqlite";
    }

    return value;
};

/**
 * Title: Connector factory extraction
 * Description: Reads the supported factory export shapes from a dynamically imported connector module.
 * Global Variables: none
 * @param moduleValue Imported module namespace.
 * @returns Connector factory.
 */
export const extractConnectorFactory = (moduleValue: Record<string, unknown>): DatabaseConnectorFactory => {
    const candidate = moduleValue.createConnector ??
        moduleValue.createDatabaseConnector ??
        moduleValue.default;

    if (typeof candidate !== "function") {
        throw createDatabaseError({
            code: "INVALID_CONNECTOR_FACTORY",
            message: "Connector package does not export a connector factory"
        });
    }

    return candidate as DatabaseConnectorFactory;
};

/**
 * Title: Path lookup
 * Description: Safely resolves dotted paths from previous query results.
 * Global Variables: none
 * @param input Source value.
 * @param path Dotted lookup path.
 * @returns Resolved value.
 */
export const getPathValue = (input: unknown, path: string | undefined): unknown => {
    if (!path) return input;

    return path.split(".").reduce<unknown>((current, segment) => {
        if (Array.isArray(current)) {
            const index = /^(0|[1-9][0-9]*)$/.test(segment) ? Number(segment) : NaN;
            return Number.isNaN(index) ? undefined : current[index];
        }

        if (typeof current === "object" && current !== null) {
            if (["__proto__", "constructor", "prototype"].includes(segment) || !Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
            return (current as Record<string, unknown>)[segment];
        }

        return undefined;
    }, input);
};

const isReferenceToken = (value: unknown): value is ResultReferenceToken =>
    typeof value === "object" &&
    value !== null &&
    "$ref" in value &&
    typeof (value as ResultReferenceToken).$ref === "object" &&
    (value as ResultReferenceToken).$ref !== null;

/**
 * Title: Reference resolver
 * Description: Resolves query result references inside JSON payloads before dispatching dependent operations.
 * Global Variables: none
 * @param value Input value.
 * @param results Previously collected results.
 * @returns Value with references resolved.
 */
export const resolveReferences = (value: unknown, results: unknown[]): unknown => {
    if (isReferenceToken(value)) {
        const referenced = results[value.$ref.operation];
        return getPathValue(referenced, value.$ref.path);
    }

    if (Array.isArray(value)) {
        return value.map((entry) => resolveReferences(entry, results));
    }

    if (typeof value === "object" && value !== null) {
        return Object.fromEntries(
            Object.entries(value).map(([key, entry]) => [key, resolveReferences(entry, results)])
        );
    }

    return value;
};

/**
 * Title: JSON assertion
 * Description: Ensures that user data remains JSON-serializable before the connector receives it.
 * Global Variables: none
 * @param value Potential JSON value.
 * @param label Value label for error reporting.
 */
export const assertJsonSerializable = (value: unknown, label: string): void => {
    try {
        const encoded = JSON.stringify(value);
        if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > 8 * 1024 * 1024) throw new Error("JSON input is missing or exceeds 8 MiB");
        // Stringifying drops unsupported JavaScript primitives; never silently strip user operations.
        const visit = (input: unknown, depth = 0): void => {
            if (depth > 64) throw new Error("JSON input nesting is too deep");
            if (input === undefined || typeof input === "function" || typeof input === "symbol" || (typeof input === "number" && !Number.isFinite(input))) throw new Error("Unsupported JSON value");
            if (Array.isArray(input)) { for (const item of input) visit(item, depth + 1); }
            else if (input !== null && typeof input === "object") {
                for (const [key, item] of Object.entries(input)) {
                    if (["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Unsafe JSON object property");
                    visit(item, depth + 1);
                }
            }
        };
        visit(value);
    } catch (error) {
        throw createDatabaseError({
            code: "NON_JSON_INPUT",
            message: `${label} must be JSON serializable`,
            cause: error
        });
    }
};

/**
 * Title: Query input clone
 * Description: Clones user query objects to avoid mutating caller references during normalization.
 * Global Variables: none
 * @param value Query value.
 * @returns Cloned value.
 */
export const cloneQueryValue = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * Title: Operation validator
 * Description: Validates the minimum shape shared across every routed operation.
 * Global Variables: none
 * @param operation Query operation.
 * @returns Operation with JSON-safe data.
 */
export const validateOperation = <T extends QueryOperation>(operation: T): T => {
    if (typeof operation !== "object" || operation === null) {
        throw createDatabaseError({
            code: "INVALID_OPERATION",
            message: "Database operation must be an object"
        });
    }

    if (typeof operation.op !== "string") {
        throw createDatabaseError({
            code: "INVALID_OPERATION",
            message: "Database operation is missing the op property"
        });
    }

    assertJsonSerializable(operation, `Database operation "${operation.op}"`);
    return cloneQueryValue(operation);
};

/**
 * Title: Redaction helper
 * Description: Builds a safe connection options summary without leaking credentials into runtime state.
 * Global Variables: none
 * @param options Connector options.
 * @returns Redacted options object.
 */
/** Never surface credential-bearing connection URLs or injected native clients. */
export const redactConnectionOptions = (options: Record<string, unknown>): Record<string, unknown> => {
    const sensitive = /password|secret|token|key|uri|url|dsn|connectionstring|credential|auth|client|executor|certificate|private|^db$/i;
    function redact(input: unknown, depth: number): unknown {
        if (depth > 5) return "[redacted]";
        if (Array.isArray(input)) return input.map(item => redact(item, depth + 1));
        if (input && typeof input === "object") {
            return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, sensitive.test(key) ? "[redacted]" : redact(value, depth + 1)]));
        }
        return typeof input === "function" ? "[redacted]" : input;
    }
    return redact(options, 0) as Record<string, unknown>;
};
