import type { BaseIssue, BaseSchema, BaseSchemaAsync } from '../types/index.js';

/** Build a fresh entry dictionary whose values all reference one trusted schema. This helper is not a validator for untrusted property names.
 * @param {TList} list - Trusted declared property keys; duplicate assignments retain the last same-schema reference.
 * @param {TSchema} schema - Borrowed child schema reused at every key, never parsed or cloned by construction.
 * @returns {Record<TList[number], TSchema>} Fresh top-level entry dictionary retaining the same borrowed child schema identity.
 */
// @__NO_SIDE_EFFECTS__
export function entriesFromList<
  const TList extends readonly (string | number | symbol)[],
  const TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(list: TList, schema: TSchema): Record<TList[number], TSchema> {
  /** Fresh top-level dictionary; all nested schema values remain borrowed. */
  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
  const entries: Record<TList[number], TSchema> = {};
  // Reuse the same child identity at each trusted key rather than cloning or parsing it.
  for (const key of list) {
    entries[key as TList[number]] = schema;
  }
  return entries;
}
