import { SearchLimitError } from "./types.js";
export function jsonBytes(value: unknown, max: number): number {
  let nodes = 0,
    bytes = 0;
  const encoder = new TextEncoder(),
    seen = new Set<object>();
  const charge = (s: string) => {
    bytes += encoder.encode(s).byteLength;
    if (bytes > max) throw new SearchLimitError("DOCUMENT_LIMIT");
  };
  const walk = (v: unknown, depth: number) => {
    if (++nodes > 20000 || depth > 16)
      throw new SearchLimitError("DOCUMENT_LIMIT");
    if (v === null || typeof v === "boolean") return;
    if (typeof v === "string") {
      charge(v);
      return;
    }
    if (typeof v === "number" && Number.isFinite(v)) return;
    if (
      !v ||
      typeof v !== "object" ||
      seen.has(v) ||
      (!Array.isArray(v) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
    )
      throw new TypeError("Search documents require inert JSON");
    if (
      Array.isArray(v) &&
      (v.length > 10000 ||
        Array.from({ length: v.length }, (_, i) => !Object.hasOwn(v, i)).some(
          Boolean,
        ))
    )
      throw new TypeError("Dense bounded JSON arrays required");
    seen.add(v);
    for (const key of Reflect.ownKeys(v)) {
      if (Array.isArray(v) && key === "length") continue;
      if (
        typeof key !== "string" ||
        ["__proto__", "constructor", "prototype"].includes(key)
      )
        throw new TypeError("Invalid document key");
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (!("value" in d)) throw new TypeError("Document accessors forbidden");
      charge(key);
      walk(d.value, depth + 1);
    }
    seen.delete(v);
  };
  walk(value, 0);
  const size = encoder.encode(JSON.stringify(value)).byteLength;
  if (size > max) throw new SearchLimitError("DOCUMENT_LIMIT");
  return size;
}
