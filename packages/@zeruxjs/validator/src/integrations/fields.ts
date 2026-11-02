import { HttpValidationError } from './issues.js';
export interface FieldPolicy {
  /** Default array: singleton stays scalar, repeated fields become arrays. */
  duplicates?: 'array' | 'reject' | 'first' | 'last';
  empty?: 'preserve' | 'omit';
  /** Only listed fields coerce. No implicit schema-driven conversions. */
  coerce?: Readonly<Record<string, 'string' | 'number' | 'boolean'>>;
  files?: 'reject' | 'preserve';
}
export interface FieldLimits { maxFields: number; maxFieldBytes: number; maxBytes: number }
export function unsafeKey(key: string): boolean {
  return key.split(/[.\[\]]/).some(segment => ['__proto__', 'constructor', 'prototype'].includes(segment));
}
export function validatePolicy(options: FieldPolicy) {
  if (options.duplicates !== undefined && !['array', 'reject', 'first', 'last'].includes(options.duplicates)) throw new TypeError('Invalid duplicate-field policy');
  if (options.empty !== undefined && !['preserve', 'omit'].includes(options.empty)) throw new TypeError('Invalid empty-field policy');
  if (options.files !== undefined && !['reject', 'preserve'].includes(options.files)) throw new TypeError('Invalid file-field policy');
  if (options.coerce !== undefined) {
    if (!options.coerce || typeof options.coerce !== 'object' || Array.isArray(options.coerce)) throw new TypeError('coerce must be a field map');
    for (const [key, value] of Object.entries(options.coerce)) if (unsafeKey(key) || !['string', 'number', 'boolean'].includes(value)) throw new TypeError('Invalid field coercion');
  }
}

/** Collect bounded literal fields into a null-prototype dictionary before validation. */
export function collectFields(entries: Iterable<readonly [string, string | File]>, policy: FieldPolicy, limits: FieldLimits, headers = false): Record<string, unknown> {
  const groups = new Map<string, (string | File)[]>();
  let count = 0, bytes = 0;
  const encoder = new TextEncoder();
  for (const [original, value] of entries) {
    if (++count > limits.maxFields) throw new HttpValidationError(413, 'Too many input fields');
    if (typeof original !== 'string') throw new HttpValidationError(400, 'Invalid field name');
    const key = headers ? original.toLowerCase() : original;
    if (!key || key.length > 256 || /[\x00-\x1f\x7f]/.test(key) || unsafeKey(key) || (headers && !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(key))) throw new HttpValidationError(400, 'Unsafe input field');
    const keyBytes = encoder.encode(key).length;
    if (keyBytes > limits.maxFieldBytes) throw new HttpValidationError(413, 'Field name too large');
    let size: number;
    if (typeof value === 'string') size = encoder.encode(value).length;
    else {
      if (policy.files !== 'preserve' || typeof File === 'undefined' || !(value instanceof File)) throw new HttpValidationError(400, 'File fields are not enabled');
      size = value.size;
    }
    if (size > (typeof value === 'string' ? limits.maxFieldBytes : limits.maxBytes)) throw new HttpValidationError(413, 'Input field too large');
    bytes += keyBytes + size;
    if (bytes > limits.maxBytes) throw new HttpValidationError(413, 'Input fields too large');
    const group = groups.get(key);
    if (group) group.push(value); else groups.set(key, [value]);
  }
  const output: Record<string, unknown> = Object.create(null);
  for (const [key, values] of groups) {
    const duplicates = policy.duplicates ?? 'array';
    if (duplicates === 'reject' && values.length > 1) throw new HttpValidationError(400, 'Duplicate input field');
    const selected = duplicates === 'first' ? [values[0]] : duplicates === 'last' ? [values[values.length - 1]] : values;
    const filtered = policy.empty === 'omit' ? selected.filter(value => value !== '') : selected;
    if (!filtered.length) continue;
    const mode = policy.coerce && Object.hasOwn(policy.coerce, key) ? policy.coerce[key] : undefined;
    const converted = filtered.map(value => {
      if (!mode) return value;
      if (typeof value !== 'string') throw new HttpValidationError(400, 'Cannot coerce a file field');
      if (mode === 'string') return value;
      if (mode === 'boolean') {
        if (value === 'true') return true;
        if (value === 'false') return false;
      } else if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value))) return Number(value);
      throw new HttpValidationError(400, 'Invalid coerced field');
    });
    output[key] = duplicates === 'array' && values.length > 1 ? converted : converted[0];
  }
  return output;
}

/** JSON does not expand dotted keys, but uses the same reserved-segment rejection. */
export function checkJsonKeys(input: unknown) {
  const pending = [input]; let nodes = 0;
  while (pending.length) {
    if (++nodes > 10000) throw new HttpValidationError(413, 'Too many JSON nodes');
    const item = pending.pop();
    if (!item || typeof item !== 'object') continue;
    for (const key of Object.keys(item)) {
      if (unsafeKey(key)) throw new HttpValidationError(400, 'Unsafe JSON property');
      pending.push((item as Record<string, unknown>)[key]);
      if (pending.length + nodes > 10000) throw new HttpValidationError(413, 'Too many JSON nodes');
    }
  }
}
