import type {
  LooseObjectIssue,
  LooseObjectSchema,
  LooseObjectSchemaAsync,
  ObjectIssue,
  ObjectSchema,
  ObjectSchemaAsync,
  ObjectWithRestIssue,
  ObjectWithRestSchema,
  ObjectWithRestSchemaAsync,
  StrictObjectIssue,
  StrictObjectSchema,
  StrictObjectSchemaAsync,
} from '../schemas/index.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  ErrorMessage,
  Merge,
  ObjectEntries,
  ObjectEntriesAsync,
  Prettify,
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
      | BaseSchema<unknown, unknown, BaseIssue<unknown>>
      | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
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
 * Recursive merge type.
 */
type RecursiveMerge<TSchemas extends readonly [Schema, ...Schema[]]> =
  TSchemas extends readonly [infer TFirstSchema extends Schema]
    ? TFirstSchema['entries']
    : TSchemas extends readonly [
          infer TFirstSchema extends Schema,
          ...infer TRestSchemas extends readonly [Schema, ...Schema[]],
        ]
      ? Merge<TFirstSchema['entries'], RecursiveMerge<TRestSchemas>>
      : never;

/**
 * Merged entries types.
 */
type MergedEntries<TSchemas extends readonly [Schema, ...Schema[]]> = Prettify<
  RecursiveMerge<TSchemas>
>;

/** Shallowly merge trusted object-schema entries in declared source order, with later schemas overriding earlier keys.
 * @param {TSchemas} schemas - Explicit nonempty ordered schema list; Object.assign may invoke host-owned entry getters.
 * @returns {MergedEntries<TSchemas>} Fresh entry dictionary with borrowed child schemas; no deep merge, parsing or unsafe-key sanitization is introduced.
 */
export function entriesFromObjects<
  const TSchemas extends readonly [Schema, ...Schema[]],
>(schemas: TSchemas): MergedEntries<TSchemas>;

/** Shallowly merge trusted object-schema entries in declared source order, with later schemas overriding earlier keys.
 * @param {[ Schema, ...Schema[] ]} schemas - Explicit nonempty ordered schema list; Object.assign may invoke host-owned entry getters.
 * @returns {MergedEntries<[ Schema, ...Schema[] ]>} Fresh entry dictionary with borrowed child schemas; no deep merge, parsing or unsafe-key sanitization is introduced.
 */
// @__NO_SIDE_EFFECTS__
export function entriesFromObjects(
  schemas: [Schema, ...Schema[]]
): MergedEntries<[Schema, ...Schema[]]> {
  /** Fresh top-level dictionary; all nested schema values remain borrowed. */
  const entries = {};
  // Apply later dictionaries last so explicit source order determines conflicts.
  for (const schema of schemas) {
    Object.assign(entries, schema.entries);
  }
  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
  return entries;
}
