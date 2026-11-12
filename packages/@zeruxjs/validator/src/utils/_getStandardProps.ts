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
 * Adapt the declared schema to Standard Schema V1 while preserving root budget, cancellation and cleanup behavior. Trusted schema callbacks remain outside a sandbox.
 *
 * @param {TSchema} context - Trusted declared sync/async schema; input is validated only on explicit validate calls.
 *
 * @returns {StandardProps<InferInput<TSchema>, InferOutput<TSchema>>} Inert V1 adapter; validate returns the declared dataset or asynchronous dataset.
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
    /** Execute through the same bounded root path as parse-family APIs.
     * @param {unknown} value - Candidate untrusted input, scanned before schema dispatch.
     * @returns {StandardResult<InferOutput<TSchema>> | Promise<StandardResult<InferOutput<TSchema>>>} Declared validation result; operational/budget failures still propagate.
     */
    validate(value) {
      return (
        context.async
          ? executeSchemaAsync(context, value)
          : executeSchema(context, value)
      ) as
        | StandardResult<InferOutput<TSchema>>
        | Promise<StandardResult<InferOutput<TSchema>>>;
    },
  };
}
