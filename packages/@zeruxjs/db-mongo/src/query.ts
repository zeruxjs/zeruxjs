import type { ComparisonOperator, QueryExpression, SelectOperation, WhereClause, WherePredicate } from "@zeruxjs/db";
import { createDatabaseError } from "@zeruxjs/db";
export const toMongoValue = (value: unknown): unknown => {
    if (
        typeof value === "object" &&
        value !== null &&
        "kind" in value &&
        typeof (value as { kind?: unknown; }).kind === "string"
    ) {
        const expression = value as Extract<QueryExpression, { kind: string; }>;
        switch (expression.kind) {
            case "column":
                assertSafeField(expression.name);
                return `$${expression.name}`;
            case "value":
                return expression.value;
            default:
                return value;
        }
    }

    return value;
};

const escapeMongoLike = (value: unknown): string => String(value)
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/%/g, ".*")
    .replace(/_/g, ".");

export const assertSafeField = (name: string): void => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(name) || name.split(".").some(part => ["__proto__", "prototype", "constructor"].includes(part))) {
        throw createDatabaseError({ code: "INVALID_WHERE", message: "Unsafe MongoDB field name" });
    }
};

/** Reject untrusted query selector objects (including nested Mongo operators). */
export function assertSafeDocument(value: unknown, maxDepth = 32): void {
    const seen = new WeakSet<object>();
    function walk(input: unknown, depth: number): void {
        if (depth > maxDepth) throw createDatabaseError({ code: "INVALID_WHERE", message: "Mongo document nesting too deep" });
        if (!input || typeof input !== "object") return;
        if (seen.has(input)) throw createDatabaseError({ code: "INVALID_WHERE", message: "Cyclic Mongo document" });
        seen.add(input);
        if (Array.isArray(input)) { for (const item of input) walk(item, depth + 1); }
        else {
            for (const [key, entry] of Object.entries(input)) {
                assertSafeField(key);
                walk(entry, depth + 1);
            }
        }
        seen.delete(input);
    }
    walk(value, 0);
}
const mapOperator = (operator: ComparisonOperator, value: unknown) => {
    switch (operator) {
        case "eq":
            return value;
        case "ne":
            return { $ne: value };
        case "gt":
            return { $gt: value };
        case "gte":
            return { $gte: value };
        case "lt":
            return { $lt: value };
        case "lte":
            return { $lte: value };
        case "like":
        case "ilike":
            return { $regex: `^${escapeMongoLike(value)}$`, ...(operator === "ilike" ? { $options: "i" } : {}) };
        case "in":
            return { $in: Array.isArray(value) ? value : [value] };
        case "notIn":
            return { $nin: Array.isArray(value) ? value : [value] };
        case "isNull":
            return null;
        case "isNotNull":
            return { $ne: null };
        default:
            throw createDatabaseError({ code: "INVALID_WHERE", message: "Unsupported Mongo comparison operator" });
    }
};

export const buildWhere = (where: WhereClause, depth = 0): Record<string, unknown> => {
    if (!where || typeof where !== "object" || depth > 32) throw createDatabaseError({ code: "INVALID_WHERE", message: "Invalid or deeply nested Mongo where clause" });
    if ("and" in where) {
        if (!where.and.length) throw createDatabaseError({ code: "INVALID_WHERE", message: "Empty Mongo AND clauses are not allowed" });
        return { $and: where.and.map((entry) => buildWhere(entry, depth + 1)) };
    }

    if ("or" in where) {
        if (!where.or.length) throw createDatabaseError({ code: "INVALID_WHERE", message: "Empty Mongo OR clauses are not allowed" });
        return { $or: where.or.map((entry) => buildWhere(entry, depth + 1)) };
    }

    if ("not" in where) {
        return { $nor: [buildWhere(where.not, depth + 1)] };
    }

    return buildPredicate(where);
};

const buildPredicate = (predicate: WherePredicate): Record<string, unknown> => {
    if (!predicate.field || typeof predicate.field !== "string") {
        throw createDatabaseError({
            code: "INVALID_WHERE",
            message: "Mongo where predicates require string field names"
        });
    }

    assertSafeField(predicate.field);

    if (predicate.operator === "between") {
        assertSafeDocument(predicate.from); assertSafeDocument(predicate.to);
        return {
            [predicate.field]: {
                $gte: toMongoValue(predicate.from),
                $lte: toMongoValue(predicate.to)
            }
        };
    }

    if (predicate.operator === "exists" || predicate.operator === "notExists") {
        return {
            [predicate.field]: {
                $exists: predicate.operator === "exists"
            }
        };
    }

    const sourceValue = predicate.values ?? predicate.value;
    assertSafeDocument(sourceValue);
    return {
        [predicate.field]: mapOperator(predicate.operator, toMongoValue(sourceValue))
    };
};

export const buildProjection = (operation: SelectOperation): Record<string, unknown> | undefined => {
    if (!operation.columns || operation.columns.length === 0) {
        return undefined;
    }

    return Object.fromEntries(
        operation.columns.map((column) => {
            if (typeof column === "string") assertSafeField(column);
            else { if (column.as) assertSafeField(column.as); if (typeof column.expr === "string") assertSafeField(column.expr); }
            if (typeof column === "string") {
                return [column, 1];
            }

            if (typeof column.expr === "string") {
                return [column.as ?? column.expr, `$${column.expr}`];
            }

            return [column.as ?? "value", toMongoValue(column.expr)];
        })
    );
};

export const buildSort = (operation: SelectOperation): Record<string, 1 | -1> | undefined => {
    if (!operation.orderBy || operation.orderBy.length === 0) {
        return undefined;
    }

    return Object.fromEntries(
        operation.orderBy.map((entry) => {
            assertSafeField(typeof entry === "string" ? entry : typeof entry.by === "string" ? entry.by : "value");
            if (typeof entry === "string") {
                return [entry, 1];
            }

            return [typeof entry.by === "string" ? entry.by : "value", entry.direction === "desc" ? -1 : 1];
        })
    );
};

