import type { CacheValue } from "@zeruxjs/cache";

export const serialize = (value: CacheValue): string => {
    const result = JSON.stringify(value);
    if (result === undefined) throw new TypeError("Cache value must be serializable JSON");
    return result;
};
export const deserialize = (encoded: string): CacheValue => JSON.parse(encoded) as CacheValue;
export const expiration = (seconds?: number): number | undefined => {
    if (seconds === undefined) return undefined;
    if (!Number.isFinite(seconds) || seconds <= 0) throw new RangeError("Cache TTL must be positive and finite");
    const result = Math.ceil(seconds);
    if (!Number.isSafeInteger(result) || result > 2147483647) throw new RangeError("Cache TTL exceeds Redis EX range");
    return result;
};
export const counterAmount = (amount: number): number => {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError("Counter amount must be a non-negative safe integer");
    return amount;
};
/** Escape Redis glob wildcards for SCAN MATCH; also filter results by literal prefix. */
export const prefixGlob = (prefix: string): string => prefix.replace(/[\\*?\[\]]/g, "\\$&") + ":*";
