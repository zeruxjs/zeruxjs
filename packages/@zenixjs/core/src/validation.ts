import { validateAddress } from '@zeruxjs/files';
import {
  CmsError,
  type CmsScope,
  type CmsContentType,
  type CmsMediaReference,
  type CmsField,
} from './types.js';
/** Construct a stable CMS error with an optional private nonenumerable cause.
 * @param {string} code - Fixed nonsensitive operational code; never pass private content as a code.
 * @param {unknown} cause - Optional private underlying failure, retained without enumerable public disclosure.
 * @returns {CmsError} New error; creating it does not throw or expose its private cause.
 */
export const fail = (code: string, cause?: unknown) =>
  new CmsError(code, cause);
/** Accept only own data properties on a plain/null-prototype object.
 * @param {unknown} value - Value to validate without coercion; callbacks/getters are not accepted as content.
 * @param {readonly string[]} allowed - Optional explicit allowlist of own property names; omission permits any data key.
 * @returns {void} No value; successful completion narrows the input to a data record.
 * @throws {CmsError} For invalid syntax, unsafe data shape or exceeded content limits; values are not included in fixed error messages.
 */
export function record(
  value: unknown,
  allowed?: readonly string[]
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(
      (k) =>
        typeof k !== 'string' ||
        (allowed && !allowed.includes(k)) ||
        !('value' in Object.getOwnPropertyDescriptor(value, k)!)
    )
  ) {
    throw fail('INVALID_INPUT');
  }
}
/** Validate bounded CMS identifiers without coercion or normalization.
 * @param {unknown} value - Value to validate without coercion; callbacks/getters are not accepted as content.
 * @returns {void} No value; successful completion narrows value to an allowed string.
 * @throws {CmsError} For invalid syntax, unsafe data shape or exceeded content limits; values are not included in fixed error messages.
 */
export function id(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) ||
    ['__proto__', 'constructor', 'prototype'].includes(value)
  ) {
    throw fail('INVALID_ID');
  }
}
/** Validate a safe integer within inclusive caller-selected limits.
 * @param {unknown} value - Value to validate without coercion; callbacks/getters are not accepted as content.
 * @param {number} min - Inclusive lower bound; defaults to 1.
 * @param {number} max - Inclusive upper bound; defaults to 1,000,000.
 * @returns {void} No value; successful completion narrows value to number.
 * @throws {CmsError} For invalid syntax, unsafe data shape or exceeded content limits; values are not included in fixed error messages.
 */
export function integer(
  value: unknown,
  min = 1,
  max = 1000000
): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  ) {
    throw fail('INVALID_NUMBER');
  }
}
/** Validate and detach the exact tenant/site scope fields.
 * @param {CmsScope} value - Value to validate without coercion; callbacks/getters are not accepted as content.
 * @returns {CmsScope} Fresh scope object; this validates syntax, not authentication or authorization.
 * @throws {CmsError} For invalid syntax, unsafe data shape or exceeded content limits; values are not included in fixed error messages.
 */
export function scoped(value: CmsScope): CmsScope {
  record(value, ['tenant', 'site']);
  id(value.tenant);
  id(value.site);
  return { tenant: value.tenant, site: value.site };
}
/** Validate a bounded schema and detach every approved field definition.
 * @param {CmsContentType} input - Untrusted own data fields validated before they enter persistent state.
 * @returns {CmsContentType} Fresh schema map with no executable/inherited data or shared field references.
 * @throws {CmsError} For invalid syntax, unsafe data shape or exceeded content limits; values are not included in fixed error messages.
 */
export function contentType(input: CmsContentType): CmsContentType {
  record(input, ['id', 'version', 'fields']);
  id(input.id);
  integer(input.version, 1, 10000);
  record(input.fields);
  /** Own schema field names; empty schemas and schemas exceeding 64 fields reject. */
  const names = Object.keys(input.fields);
  if (!names.length || names.length > 64) {
    throw fail('INVALID_SCHEMA');
  }
  /** Detached null-prototype schema map; no inherited or executable content is retained. */
  const fields: Record<string, CmsField> = Object.create(null);
  // name is an own schema field; syntax/shape validation precedes any detached copy.
  for (const name of names) {
    id(name);
    /** One schema field, checked for permitted keys/kind/bounds before cloning. */
    const f = input.fields[name];
    record(f);
    if (f.required !== undefined && typeof f.required !== 'boolean') {
      throw fail('INVALID_SCHEMA');
    }
    if (f.kind === 'text') {
      record(f, ['kind', 'required', 'maxLength', 'values']);
      integer(f.maxLength, 1, 8192);
      if (
        f.values !== undefined &&
        (!Array.isArray(f.values) ||
          Object.getPrototypeOf(f.values) !== Array.prototype ||
          !f.values.length ||
          f.values.length > 64 ||
          Object.keys(f.values).length !== f.values.length ||
          Object.values(Object.getOwnPropertyDescriptors(f.values)).some(
            (d) => !('value' in d)
          ) ||
          f.values.some(
            (v) => typeof v !== 'string' || v.length > f.maxLength
          ) ||
          new Set(f.values).size !== f.values.length)
      ) {
        throw fail('INVALID_SCHEMA');
      }
    } else if (f.kind === 'number') {
      record(f, ['kind', 'required', 'min', 'max']);
      if (
        typeof f.min !== 'number' ||
        !Number.isFinite(f.min) ||
        typeof f.max !== 'number' ||
        !Number.isFinite(f.max) ||
        f.min > f.max
      ) {
        throw fail('INVALID_SCHEMA');
      }
    } else if (f.kind === 'media' || f.kind === 'boolean') {
      record(f, ['kind', 'required']);
    } else {
      throw fail('INVALID_SCHEMA');
    }
    fields[name] = structuredClone(f) as CmsField;
  }
  return { id: input.id, version: input.version, fields };
}
/** Validate files-owned addressing plus immutable media version/hash metadata.
 * @param {unknown} input - Untrusted own data fields validated before they enter persistent state.
 * @returns {CmsMediaReference} Normalized reference; ownership/access still requires the host authorizeMedia callback.
 * @throws {CmsError} For invalid syntax, unsafe data shape or exceeded content limits; values are not included in fixed error messages.
 */
export function media(input: unknown): CmsMediaReference {
  record(input, ['storage', 'bucket', 'key', 'versionId', 'sha256']);
  if (
    typeof input.versionId !== 'string' ||
    input.versionId.length < 1 ||
    input.versionId.length > 256 ||
    // eslint-disable-next-line no-control-regex -- Reject control characters in validated input; these ranges are intentional.
    /[\x00-\x1f]/.test(input.versionId) ||
    typeof input.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.sha256)
  ) {
    throw fail('INVALID_MEDIA');
  }
  try {
    return {
      ...validateAddress(input as unknown as CmsMediaReference),
      versionId: input.versionId,
      sha256: input.sha256,
    };
  } catch (error) {
    throw fail('INVALID_MEDIA', error);
  }
}
/** Validate entry values against the immutable content schema and byte budget.
 * @param {CmsContentType} schema - Previously validated immutable schema used to check each own input field.
 * @param {unknown} input - Untrusted own data fields validated before they enter persistent state.
 * @returns {CmsRevision["values"]} Detached bounded content values; strings remain untrusted inert text.
 * @throws {CmsError} For invalid syntax, unsafe data shape or exceeded content limits; values are not included in fixed error messages.
 */
export function values(schema: CmsContentType, input: unknown) {
  record(input);
  if (Object.keys(input).some((k) => !Object.hasOwn(schema.fields, k))) {
    throw fail('INVALID_CONTENT');
  }
  /** Detached validated values, serialized only after all field constraints pass. */
  const result: Record<string, string | number | boolean | CmsMediaReference> =
    Object.create(null);
  // Each schema name/field governs one own input value; unknown input keys reject above.
  for (const [name, field] of Object.entries(schema.fields)) {
    if (!Object.hasOwn(input, name)) {
      if (field.required) {
        throw fail('INVALID_CONTENT');
      }
      continue;
    }
    /** Own input field value; content is data, not a template or executable expression. */
    const value = input[name];
    if (field.kind === 'text') {
      if (
        typeof value !== 'string' ||
        value.length > field.maxLength ||
        (field.values && !field.values.includes(value))
      ) {
        throw fail('INVALID_CONTENT');
      }
      result[name] = value;
    } else if (field.kind === 'number') {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < field.min ||
        value > field.max
      ) {
        throw fail('INVALID_CONTENT');
      }
      result[name] = value;
    } else if (field.kind === 'boolean') {
      if (typeof value !== 'boolean') {
        throw fail('INVALID_CONTENT');
      }
      result[name] = value;
    } else {
      result[name] = media(value);
    }
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 32768) {
    throw fail('CONTENT_SIZE');
  }
  return result;
}
