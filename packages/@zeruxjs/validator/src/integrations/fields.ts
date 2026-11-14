import { HttpValidationError } from './issues.js';
export interface FieldPolicy {
  /** Default array: singleton stays scalar, repeated fields become arrays. */
  duplicates?: 'array' | 'reject' | 'first' | 'last';
  /** Preserve empty values by default, or omit selected empty strings before schema defaults. */
  empty?: 'preserve' | 'omit';
  /** Only listed fields coerce. No implicit schema-driven conversions. */
  coerce?: Readonly<Record<string, 'string' | 'number' | 'boolean'>>;
  /** Reject file fields by default; preserve explicitly permits bounded borrowed File values. */
  files?: 'reject' | 'preserve';
}
export interface FieldLimits {
  /** Validated total occurrence count, including duplicate names before selection. */
  maxFields: number;
  /** UTF-8 ceiling for each field name and string value. */
  maxFieldBytes: number;
  /** Total name/value UTF-8 bytes plus preserved File sizes. */
  maxBytes: number;
}
/** Reject reserved prototype-pollution names even within literal dot/bracket segments. This never expands a key into a nested property path.
 * @param {string} key - Candidate literal query/header/form/JSON property name.
 * @returns {boolean} Whether any segment uses a reserved prototype name.
 */
export function unsafeKey(key: string): boolean {
  return key
    .split(/[.[\]]/)
    .some((segment) =>
      ['__proto__', 'constructor', 'prototype'].includes(segment)
    );
}
/** Validate explicit duplicate/empty/file and named scalar coercion policies before reading input.
 * @param {FieldPolicy} options - Trusted host field policy; unknown mode values and unsafe coercion names reject.
 * @returns {void} Completes for supported policy; no schema-based conversion is inferred.
 */
export function validatePolicy(options: FieldPolicy) {
  if (
    options.duplicates !== undefined &&
    !['array', 'reject', 'first', 'last'].includes(options.duplicates)
  ) {
    throw new TypeError('Invalid duplicate-field policy');
  }
  if (
    options.empty !== undefined &&
    !['preserve', 'omit'].includes(options.empty)
  ) {
    throw new TypeError('Invalid empty-field policy');
  }
  if (
    options.files !== undefined &&
    !['reject', 'preserve'].includes(options.files)
  ) {
    throw new TypeError('Invalid file-field policy');
  }
  if (options.coerce !== undefined) {
    if (
      !options.coerce ||
      typeof options.coerce !== 'object' ||
      Array.isArray(options.coerce)
    ) {
      throw new TypeError('coerce must be a field map');
    }
    // Reject unsupported per-field coercions before any input is consumed.
    for (const [key, value] of Object.entries(options.coerce)) {
      if (unsafeKey(key) || !['string', 'number', 'boolean'].includes(value)) {
        throw new TypeError('Invalid field coercion');
      }
    }
  }
}

/** Collect bounded literal fields into a null-prototype dictionary before schema validation. Apply duplicate selection before empty handling; named coercion never invents a missing field or reads file bytes.
 * @param {Iterable<readonly [string, string | File]>} entries - Decoded literal name/value pairs; Fetch/native Headers may already have merged wire duplicates.
 * @param {FieldPolicy} policy - Validated host duplicate/empty/file and explicit named-coercion policy.
 * @param {FieldLimits} limits - Validated field/count/UTF-8 totals, including preserved File sizes.
 * @param {boolean} headers - True lowercases and validates HTTP field-name tokens; default false.
 * @returns {Record<string, unknown>} Bounded independent field dictionary; File values remain borrowed objects for schemas to inspect.
 */
export function collectFields(
  entries: Iterable<readonly [string, string | File]>,
  policy: FieldPolicy,
  limits: FieldLimits,
  headers = false
): Record<string, unknown> {
  /** Bounded literal occurrence groups preserve arrival order for duplicate policy. */
  const groups = new Map<string, (string | File)[]>();
  let count = 0,
    bytes = 0;
  /** Native UTF-8 encoder used for actual field-name/string byte counts. */
  const encoder = new TextEncoder();
  // Count every occurrence and actual bytes before duplicate selection can discard anything.
  for (const [original, value] of entries) {
    if (++count > limits.maxFields) {
      throw new HttpValidationError(413, 'Too many input fields');
    }
    if (typeof original !== 'string') {
      throw new HttpValidationError(400, 'Invalid field name');
    }
    /** Literal name, lowercased only in header mode; no dot/bracket expansion. */
    const key = headers ? original.toLowerCase() : original;

    if (
      !key ||
      key.length > 256 ||
      // eslint-disable-next-line no-control-regex -- Reject control characters; this existing validation range is intentional.
      /[\x00-\x1f\x7f]/.test(key) ||
      unsafeKey(key) ||
      (headers && !/^[!#$%&'*+.^_`|~0-9a-z-]+$/.test(key))
    ) {
      throw new HttpValidationError(400, 'Unsafe input field');
    }
    /** Actual UTF-8 name length counted toward per-field and aggregate limits. */
    const keyBytes = encoder.encode(key).length;
    if (keyBytes > limits.maxFieldBytes) {
      throw new HttpValidationError(413, 'Field name too large');
    }
    let size: number;
    if (typeof value === 'string') {
      size = encoder.encode(value).length;
    } else {
      if (
        policy.files !== 'preserve' ||
        typeof File === 'undefined' ||
        !(value instanceof File)
      ) {
        throw new HttpValidationError(400, 'File fields are not enabled');
      }
      size = value.size;
    }
    if (
      size >
      (typeof value === 'string' ? limits.maxFieldBytes : limits.maxBytes)
    ) {
      throw new HttpValidationError(413, 'Input field too large');
    }
    bytes += keyBytes + size;
    if (bytes > limits.maxBytes) {
      throw new HttpValidationError(413, 'Input fields too large');
    }
    /** Existing occurrence array for this literal normalized name. */
    const group = groups.get(key);
    if (group) {
      group.push(value);
    } else {
      groups.set(key, [value]);
    }
  }
  /** Fresh prototype-safe validated field dictionary. */
  const output: Record<string, unknown> = Object.create(null);
  // Apply one explicit policy per literal normalized field; never expand nested paths.
  for (const [key, values] of groups) {
    /** Explicit selection policy, default array preserving repeated occurrences. */
    const duplicates = policy.duplicates ?? 'array';
    if (duplicates === 'reject' && values.length > 1) {
      throw new HttpValidationError(400, 'Duplicate input field');
    }
    // Select literal occurrences before removing empties or applying named coercion.
    let selected: typeof values;
    if (duplicates === 'first') {
      // Groups are created with their first occurrence and never emptied before selection.
      selected = [values[0]!];
    } else if (duplicates === 'last') {
      selected = [values[values.length - 1]!];
    } else {
      selected = values;
    }
    /** Selected occurrences after optional empty omission; repeated-array identity remains deliberate. */
    const filtered =
      policy.empty === 'omit'
        ? selected.filter((value) => value !== '')
        : selected;
    if (!filtered.length) {
      continue;
    }
    /** Only this explicitly configured own field may coerce; no inference from schema types. */
    const mode =
      policy.coerce && Object.hasOwn(policy.coerce, key)
        ? policy.coerce[key]
        : undefined;
    /** Selected finite scalar conversions or borrowed File objects; malformed coercion rejects. */
    const converted = filtered.map((value) => {
      if (!mode) {
        return value;
      }
      if (typeof value !== 'string') {
        throw new HttpValidationError(400, 'Cannot coerce a file field');
      }
      if (mode === 'string') {
        return value;
      }
      if (mode === 'boolean') {
        if (value === 'true') {
          return true;
        }
        if (value === 'false') {
          return false;
        }
      } else if (
        /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value) &&
        Number.isFinite(Number(value))
      ) {
        return Number(value);
      }
      throw new HttpValidationError(400, 'Invalid coerced field');
    });
    output[key] =
      duplicates === 'array' && values.length > 1 ? converted : converted[0];
  }
  return output;
}

/** Inspect parsed JSON with a bounded iterative work list and reject reserved segments before schema stripping. This helper expects parsed JSON, not an arbitrary executable object graph.
 * @param {unknown} input - Already-decoded JSON data whose nested literal property names need checking.
 * @returns {void} Completes within ten thousand nodes; no dotted property expansion occurs.
 */
export function checkJsonKeys(input: unknown) {
  /** Bounded iterative parsed-JSON work list, not recursive arbitrary code execution. */
  const pending = [input];
  let nodes = 0;
  // Keep both visited and queued JSON work within the same finite node ceiling.
  while (pending.length) {
    if (++nodes > 10000) {
      throw new HttpValidationError(413, 'Too many JSON nodes');
    }
    /** One already-decoded JSON node inspected before adding its own children. */
    const item = pending.pop();
    if (!item || typeof item !== 'object') {
      continue;
    }
    // Inspect parsed JSON keys only; schema stripping cannot hide reserved names.
    for (const key of Object.keys(item)) {
      if (unsafeKey(key)) {
        throw new HttpValidationError(400, 'Unsafe JSON property');
      }
      pending.push((item as Record<string, unknown>)[key]);
      if (pending.length + nodes > 10000) {
        throw new HttpValidationError(413, 'Too many JSON nodes');
      }
    }
  }
}
