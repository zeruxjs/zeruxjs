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
import { getFallback } from './getFallback.js';
import type { InferFallbacks } from './types/getFallbacks.js';

/**
 * Returns the fallback values of the schema.
 *
 * Hint: The difference to `getFallback` is that for object and tuple schemas
 * this function recursively returns the fallback values of the subschemas
 * instead of `undefined`.
 *
 * @param {TSchema} schema - Borrowed trusted schema tree; reading leaves may execute host-owned fallback factories without an input dataset or root parse budget.
 *
 * @returns {InferFallbacks<TSchema>} Fresh object/tuple structure with borrowed leaf values; leaves are not parsed or deep-cloned and factory failures propagate.
 */
// @__NO_SIDE_EFFECTS__
export function getFallbacks<
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
>(schema: TSchema): InferFallbacks<TSchema> {
  // Structural objects take precedence over wrapper-level fallback metadata; recurse declared entries only.
  if ('entries' in schema) {
    /** Fresh result dictionary; leaf values retain the identity supplied by their factories. */
    const object: Record<string, unknown> = {};
    // Enumerated entries belong to the trusted schema dictionary, whose values are schemas.
    for (const key in schema.entries) {
      object[key] = getFallbacks(schema.entries[key]!);
    }
    return object as InferFallbacks<TSchema>;
  }

  // Preserve declared tuple order; dynamic rest values have no instances to enumerate here.
  if ('items' in schema) {
    return schema.items.map(getFallbacks) as InferFallbacks<TSchema>;
  }

  // Otherwise, return fallback or `undefined`
  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
  return getFallback(schema);
}
