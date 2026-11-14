import {
  type LooseObjectIssue,
  type LooseObjectSchema,
  type LooseObjectSchemaAsync,
  type ObjectIssue,
  type ObjectSchema,
  type ObjectSchemaAsync,
  type ObjectWithRestIssue,
  type ObjectWithRestSchema,
  type ObjectWithRestSchemaAsync,
  picklist,
  type PicklistIssue,
  type PicklistSchema,
  type StrictObjectIssue,
  type StrictObjectSchema,
  type StrictObjectSchemaAsync,
} from '../schemas/index.js';
import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  ObjectEntries,
  ObjectEntriesAsync,
  UnionToTuple,
} from '../types/index.js';

/**
 * Schema type.
 */
type Schema =
  | LooseObjectSchema<ObjectEntries, ErrorMessage<LooseObjectIssue> | undefined>
  | LooseObjectSchemaAsync<
      ObjectEntriesAsync,
      ErrorMessage<LooseObjectIssue> | undefined
    >
  | ObjectSchema<ObjectEntries, ErrorMessage<ObjectIssue> | undefined>
  | ObjectSchemaAsync<ObjectEntriesAsync, ErrorMessage<ObjectIssue> | undefined>
  | ObjectWithRestSchema<
      ObjectEntries,
      BaseSchema<unknown, unknown, BaseIssue<unknown>>,
      ErrorMessage<ObjectWithRestIssue> | undefined
    >
  | ObjectWithRestSchemaAsync<
      ObjectEntriesAsync,
      BaseSchema<unknown, unknown, BaseIssue<unknown>>,
      ErrorMessage<ObjectWithRestIssue> | undefined
    >
  | StrictObjectSchema<
      ObjectEntries,
      ErrorMessage<StrictObjectIssue> | undefined
    >
  | StrictObjectSchemaAsync<
      ObjectEntriesAsync,
      ErrorMessage<StrictObjectIssue> | undefined
    >;

/**
 * Force tuple type.
 */
type ForceTuple<T> = T extends [string, ...string[]] ? T : [];

/**
 * Object keys type.
 */
type ObjectKeys<TSchema extends Schema> = ForceTuple<
  UnionToTuple<keyof TSchema['entries']>
>;

/** Capture Object.keys of a trusted schema dictionary in a picklist; this is a schema-key list, not tenant/site permission policy.
 * @param {TSchema} schema - Borrowed declared schema; no runtime data is validated by this structural/metadata operation.
 * @returns {PicklistSchema<ObjectKeys<TSchema>, undefined>} Declared borrowed metadata/child or fresh outer action/schema; no new disposal owner or permission boundary.
 */
export function keyof<const TSchema extends Schema>(
  schema: TSchema
): PicklistSchema<ObjectKeys<TSchema>, undefined>;

/** Capture Object.keys of a trusted schema dictionary in a picklist; this is a schema-key list, not tenant/site permission policy.
 * @param {TSchema} schema - Borrowed declared schema; no runtime data is validated by this structural/metadata operation.
 * @param {TMessage} message - Optional trusted private picklist diagnostic policy.
 * @returns {PicklistSchema<ObjectKeys<TSchema>, TMessage>} Declared borrowed metadata/child or fresh outer action/schema; no new disposal owner or permission boundary.
 */
export function keyof<
  const TSchema extends Schema,
  const TMessage extends ErrorMessage<PicklistIssue> | undefined,
>(
  schema: TSchema,
  message: TMessage
): PicklistSchema<ObjectKeys<TSchema>, TMessage>;

/** Capture Object.keys of a trusted schema dictionary in a picklist; this is a schema-key list, not tenant/site permission policy.
 * @param {Schema} schema - Borrowed declared schema; no runtime data is validated by this structural/metadata operation.
 * @param {ErrorMessage<PicklistIssue>} message - Optional trusted private picklist diagnostic policy.
 * @returns {PicklistSchema<ObjectKeys<Schema>, ErrorMessage<PicklistIssue> | undefined>} Declared borrowed metadata/child or fresh outer action/schema; no new disposal owner or permission boundary.
 */
// @__NO_SIDE_EFFECTS__
export function keyof(
  schema: Schema,
  message?: ErrorMessage<PicklistIssue>
): PicklistSchema<ObjectKeys<Schema>, ErrorMessage<PicklistIssue> | undefined> {
  return picklist(Object.keys(schema.entries) as ObjectKeys<Schema>, message);
}
