import { executeSchema, executeSchemaAsync } from './_run.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  InferInput,
  InferOutput,
  StandardProps,
  StandardResult,
} from '../types/index.js';

/**
 * Returns the Standard Schema properties.
 *
 * @param context The schema context.
 *
 * @returns The Standard Schema properties.
 */
// @__NO_SIDE_EFFECTS__
export function _getStandardProps<
  TSchema extends
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(context: TSchema): StandardProps<InferInput<TSchema>, InferOutput<TSchema>> {
  return {
    version: 1,
    vendor: '@zeruxjs/validator',
    validate(value) {
      return (context.async ? executeSchemaAsync(context, value) : executeSchema(context, value)) as
        | StandardResult<InferOutput<TSchema>>
        | Promise<StandardResult<InferOutput<TSchema>>>;
    },
  };
}
