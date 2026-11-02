import { validateAddress } from '@zeruxjs/files';
import {
  CmsError,
  type CmsScope,
  type CmsContentType,
  type CmsMediaReference,
  type CmsField,
} from './types.js';
export const fail = (code: string, cause?: unknown) =>
  new CmsError(code, cause);
export function record(
  value: unknown,
  allowed?: readonly string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(
      (k) =>
        typeof k !== 'string' ||
        (allowed && !allowed.includes(k)) ||
        !('value' in Object.getOwnPropertyDescriptor(value, k)!),
    )
  )
    throw fail('INVALID_INPUT');
}
export function id(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value) ||
    ['__proto__', 'constructor', 'prototype'].includes(value)
  )
    throw fail('INVALID_ID');
}
export function integer(
  value: unknown,
  min = 1,
  max = 1000000,
): asserts value is number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < min ||
    value > max
  )
    throw fail('INVALID_NUMBER');
}
export function scoped(value: CmsScope): CmsScope {
  record(value, ['tenant', 'site']);
  id(value.tenant);
  id(value.site);
  return { tenant: value.tenant, site: value.site };
}
export function contentType(input: CmsContentType): CmsContentType {
  record(input, ['id', 'version', 'fields']);
  id(input.id);
  integer(input.version, 1, 10000);
  record(input.fields);
  const names = Object.keys(input.fields);
  if (!names.length || names.length > 64) throw fail('INVALID_SCHEMA');
  const fields: Record<string, CmsField> = Object.create(null);
  for (const name of names) {
    id(name);
    const f = input.fields[name];
    record(f);
    if (f.required !== undefined && typeof f.required !== 'boolean')
      throw fail('INVALID_SCHEMA');
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
            (d) => !('value' in d),
          ) ||
          f.values.some(
            (v) => typeof v !== 'string' || v.length > f.maxLength,
          ) ||
          new Set(f.values).size !== f.values.length)
      )
        throw fail('INVALID_SCHEMA');
    } else if (f.kind === 'number') {
      record(f, ['kind', 'required', 'min', 'max']);
      if (
        typeof f.min !== 'number' ||
        !Number.isFinite(f.min) ||
        typeof f.max !== 'number' ||
        !Number.isFinite(f.max) ||
        f.min > f.max
      )
        throw fail('INVALID_SCHEMA');
    } else if (f.kind === 'media' || f.kind === 'boolean')
      record(f, ['kind', 'required']);
    else throw fail('INVALID_SCHEMA');
    fields[name] = structuredClone(f) as CmsField;
  }
  return { id: input.id, version: input.version, fields };
}
export function media(input: unknown): CmsMediaReference {
  record(input, ['storage', 'bucket', 'key', 'versionId', 'sha256']);
  if (
    typeof input.versionId !== 'string' ||
    input.versionId.length < 1 ||
    input.versionId.length > 256 ||
    /[\x00-\x1f]/.test(input.versionId) ||
    typeof input.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.sha256)
  )
    throw fail('INVALID_MEDIA');
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
export function values(schema: CmsContentType, input: unknown) {
  record(input);
  if (Object.keys(input).some((k) => !Object.hasOwn(schema.fields, k)))
    throw fail('INVALID_CONTENT');
  const result: Record<string, string | number | boolean | CmsMediaReference> =
    Object.create(null);
  for (const [name, field] of Object.entries(schema.fields)) {
    if (!Object.hasOwn(input, name)) {
      if (field.required) throw fail('INVALID_CONTENT');
      continue;
    }
    const value = input[name];
    if (field.kind === 'text') {
      if (
        typeof value !== 'string' ||
        value.length > field.maxLength ||
        (field.values && !field.values.includes(value))
      )
        throw fail('INVALID_CONTENT');
      result[name] = value;
    } else if (field.kind === 'number') {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < field.min ||
        value > field.max
      )
        throw fail('INVALID_CONTENT');
      result[name] = value;
    } else if (field.kind === 'boolean') {
      if (typeof value !== 'boolean') throw fail('INVALID_CONTENT');
      result[name] = value;
    } else result[name] = media(value);
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 32768)
    throw fail('CONTENT_SIZE');
  return result;
}
