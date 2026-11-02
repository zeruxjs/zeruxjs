/** Private JSON snapshot; rejects getters, cycles, instances, nonfinite values and excessive work. */
export function snapshotAiJson(input: unknown, maxBytes: number): unknown {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 67108864)
        throw new TypeError('Invalid JSON budget');
    let remaining = maxBytes, nodes = 0;
    const seen = new Set<object>();
    const visit = (v: unknown, depth: number): unknown => {
        if (depth > 32 || ++nodes > 10000)
            throw new TypeError('Tool JSON complexity exceeded');
        if (v === null || typeof v === 'boolean') {
            remaining -= 5;
        }
        else if (typeof v === 'number' && Number.isFinite(v)) {
            remaining -= 24;
        }
        else if (typeof v === 'string') {
            remaining -= Buffer.byteLength(v) + 2;
        }
        else if (v && typeof v === 'object' && !seen.has(v) && (Array.isArray(v) || Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null)) {
            seen.add(v);
            const keys = Object.keys(v);
            if (keys.length > 10000)
                throw new TypeError('Tool JSON complexity exceeded');
            const out: any = Array.isArray(v) ? [] : Object.create(null);
            for (const key of keys) {
                const d = Object.getOwnPropertyDescriptor(v, key);
                if (!d || !('value' in d))
                    throw new TypeError('Tool JSON accessors denied');
                remaining -= Buffer.byteLength(key) + 4;
                if (remaining < 0)
                    throw new RangeError('Tool JSON budget exceeded');
                Object.defineProperty(out, key, { value: visit(d.value, depth + 1), enumerable: true, writable: true, configurable: true });
            }
            seen.delete(v);
            return out;
        }
        else
            throw new TypeError('Tool JSON required');
        if (remaining < 0)
            throw new RangeError('Tool JSON budget exceeded');
        return v;
    };
    const copied = visit(input, 0), encoded = JSON.stringify(copied);
    if (Buffer.byteLength(encoded) > maxBytes)
        throw new RangeError('Tool JSON budget exceeded');
    return JSON.parse(encoded);
}
