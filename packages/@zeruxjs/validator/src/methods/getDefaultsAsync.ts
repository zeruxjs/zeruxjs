import type {
  LooseObjectIssue,
  LooseObjectSchema,
  LooseObjectSchemaAsync,
  LooseTupleIssue,
  LooseTupleSchema,
  LooseTupleSchemaAsync,
  ObjectIssue,
  ObjectSchema,
  ObjectSchemaAsync,
  ObjectWithRestIssue,
  ObjectWithRestSchema,
  ObjectWithRestSchemaAsync,
  StrictObjectIssue,
  StrictObjectSchema,
  StrictObjectSchemaAsync,
  StrictTupleIssue,
  StrictTupleSchema,
  StrictTupleSchemaAsync,
  TupleIssue,
  TupleSchema,
  TupleSchemaAsync,
  TupleWithRestIssue,
  TupleWithRestSchema,
  TupleWithRestSchemaAsync,
} from '../schemas/index.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  ErrorMessage,
  ObjectEntries,
  ObjectEntriesAsync,
  TupleItems,
  TupleItemsAsync,
} from '../types/index.js';
import { getDefault } from './getDefault.js';
import type { InferDefaults } from './types/getDefaults.js';

/**
 * Returns the default values of the schema.
 *
 * Hint: The difference to `getDefault` is that for object and tuple schemas
 * this function recursively returns the default values of the subschemas
 * instead of `undefined`.
 *
 * @param {TSchema} schema - Borrowed trusted schema tree; reading leaves may execute host-owned default factories without an input dataset or root parse budget.
 *
 * @returns {Promise<InferDefaults<TSchema>>} Fresh object/tuple structure with borrowed leaf values; leaves are not parsed or deep-cloned and factory failures propagate.
 */
// @__NO_SIDE_EFFECTS__
export async function getDefaultsAsync<
  const TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
    | LooseObjectSchema<
        ObjectEntries,
        ErrorMessage<LooseObjectIssue> | undefined
      >
    | LooseObjectSchemaAsync<
        ObjectEntriesAsync,
        ErrorMessage<LooseObjectIssue> | undefined
      >
    | LooseTupleSchema<TupleItems, ErrorMessage<LooseTupleIssue> | undefined>
    | LooseTupleSchemaAsync<
        TupleItemsAsync,
        ErrorMessage<LooseTupleIssue> | undefined
      >
    | ObjectSchema<ObjectEntries, ErrorMessage<ObjectIssue> | undefined>
    | ObjectSchemaAsync<
        ObjectEntriesAsync,
        ErrorMessage<ObjectIssue> | undefined
      >
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
      >
    | StrictTupleSchema<TupleItems, ErrorMessage<StrictTupleIssue> | undefined>
    | StrictTupleSchemaAsync<
        TupleItemsAsync,
        ErrorMessage<StrictTupleIssue> | undefined
      >
    | TupleSchema<TupleItems, ErrorMessage<TupleIssue> | undefined>
    | TupleSchemaAsync<TupleItemsAsync, ErrorMessage<TupleIssue> | undefined>
    | TupleWithRestSchema<
        TupleItems,
        BaseSchema<unknown, unknown, BaseIssue<unknown>>,
        ErrorMessage<TupleWithRestIssue> | undefined
      >
    | TupleWithRestSchemaAsync<
        TupleItemsAsync,
        | BaseSchema<unknown, unknown, BaseIssue<unknown>>
        | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
        ErrorMessage<TupleWithRestIssue> | undefined
      >,
>(schema: TSchema): Promise<InferDefaults<TSchema>> {
  // Structural objects take precedence over wrapper-level default metadata; recurse declared entries only.
  if ('entries' in schema) {
    // Sibling factories start together; Promise.all rejection does not cancel their independent work.
    return Object.fromEntries(
      await Promise.all(
        Object.entries(schema.entries).map(async ([key, value]) => [
          key,
          await getDefaultsAsync(value),
        ])
      )
    ) as InferDefaults<TSchema>;
  }

  // Preserve declared tuple order; dynamic rest values have no instances to enumerate here.
  if ('items' in schema) {
    return Promise.all(schema.items.map(getDefaultsAsync)) as Promise<
      InferDefaults<TSchema>
    >;
  }

  // Otherwise, return default or `undefined`
  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
  return getDefault(schema);
}
