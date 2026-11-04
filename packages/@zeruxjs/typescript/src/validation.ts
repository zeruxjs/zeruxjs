/** Validate a trusted tool option at the JavaScript/JSON boundary. */
export function nonemptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new TypeError(`${name} must be a nonempty string without NUL characters`);
  }
}
/** Bound explicit input lists; compiler-discovered project graphs remain compiler-owned. */
export function stringList(value: unknown, name: string): asserts value is string[] {
  if (!Array.isArray(value) || value.length > 10000) throw new TypeError(`${name} must be an array of at most 10000 strings`);
  for (const item of value) nonemptyString(item, name);
}
