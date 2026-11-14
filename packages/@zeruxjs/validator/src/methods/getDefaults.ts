import type {
  LooseObjectIssue,
  LooseObjectSchema,
  LooseTupleIssue,
  LooseTupleSchema,
  ObjectIssue,
  ObjectSchema,
  ObjectWithRestIssue,
  ObjectWithRestSchema,
  StrictObjectIssue,
  StrictObjectSchema,
  StrictTupleIssue,
  StrictTupleSchema,
  TupleIssue,
  TupleSchema,
  TupleWithRestIssue,
  TupleWithRestSchema,
} from '../schemas/index.js';
import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  ObjectEntries,
  TupleItems,
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
 * @returns {InferDefaults<TSchema>} Fresh object/tuple structure with borrowed leaf values; leaves are not parsed or deep-cloned and factory failures propagate.
 */
// @__NO_SIDE_EFFECTS__
export function getDefaults<
  const TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | LooseObjectSchema<
        ObjectEntries,
        ErrorMessage<LooseObjectIssue> | undefined
      >
    | LooseTupleSchema<TupleItems, ErrorMessage<LooseTupleIssue> | undefined>
    | ObjectSchema<ObjectEntries, ErrorMessage<ObjectIssue> | undefined>
    | ObjectWithRestSchema<
        ObjectEntries,
        BaseSchema<unknown, unknown, BaseIssue<unknown>>,
        ErrorMessage<ObjectWithRestIssue> | undefined
      >
    | StrictObjectSchema<
        ObjectEntries,
        ErrorMessage<StrictObjectIssue> | undefined
      >
    | StrictTupleSchema<TupleItems, ErrorMessage<StrictTupleIssue> | undefined>
    | TupleSchema<TupleItems, ErrorMessage<TupleIssue> | undefined>
    | TupleWithRestSchema<
        TupleItems,
        BaseSchema<unknown, unknown, BaseIssue<unknown>>,
        ErrorMessage<TupleWithRestIssue> | undefined
      >,
>(schema: TSchema): InferDefaults<TSchema> {
  // Structural objects take precedence over wrapper-level default metadata; recurse declared entries only.
  if ('entries' in schema) {
    /** Fresh result dictionary; leaf values retain the identity supplied by their factories. */
    const object: Record<string, unknown> = {};
    // Enumerated entries belong to the trusted schema dictionary, whose values are schemas.
    for (const key in schema.entries) {
      object[key] = getDefaults(schema.entries[key]!);
    }
    return object as InferDefaults<TSchema>;
  }

  // Preserve declared tuple order; dynamic rest values have no instances to enumerate here.
  if ('items' in schema) {
    return schema.items.map(getDefaults) as InferDefaults<TSchema>;
  }

  // Otherwise, return default or `undefined`
  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
  return getDefault(schema);
}
