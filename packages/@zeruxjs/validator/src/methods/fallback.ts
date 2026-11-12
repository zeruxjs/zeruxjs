import { _runSchema } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  Config,
  InferIssue,
  InferOutput,
  MaybeDeepReadonly,
  OutputDataset,
} from '../types/index.js';
import { _getStandardProps } from '../utils/index.js';
import { getFallback } from './getFallback.js';

/**
 * Fallback type.
 */
export type Fallback<
  TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
> =
  | MaybeDeepReadonly<InferOutput<TSchema>>
  | ((
      dataset?: OutputDataset<InferOutput<TSchema>, InferIssue<TSchema>>,
      config?: Config<InferIssue<TSchema>>
    ) => MaybeDeepReadonly<InferOutput<TSchema>>);

/**
 * Schema with fallback type.
 */
export type SchemaWithFallback<
  TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TFallback extends Fallback<TSchema>,
> = TSchema & {
  /**
   * Trusted output literal/factory retained by reference; type compatibility is not runtime revalidation.
   */
  readonly fallback: TFallback;
};

/**
 * Replace ordinary schema rejection with an explicitly trusted fallback value/factory. Operational, cancellation and budget failures still propagate; the replacement is not revalidated by the wrapped schema.
 *
 * @param {TSchema} schema - Trusted declared schema whose ordinary issue result may select a fallback.
 * @param {TFallback} fallback - Trusted output-compatible literal/factory retained by reference, not arbitrary source code.
 *
 * @returns {SchemaWithFallback<TSchema, TFallback>} Inert fallback wrapper; literal/output identity is not deep-cloned.
 */
// @__NO_SIDE_EFFECTS__
export function fallback<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TFallback extends Fallback<TSchema>,
>(
  schema: TSchema,
  fallback: TFallback
): SchemaWithFallback<TSchema, TFallback> {
  return {
    ...schema,
    fallback,
    get '~standard'() {
      return _getStandardProps(this);
    },
    '~run'(dataset, config) {
      /** Completed schema dataset; only ordinary issues select replacement, never operational exceptions. */
      const outputDataset = _runSchema(schema, dataset, config);
      return outputDataset.issues
        ? { typed: true, value: getFallback(this, outputDataset, config) }
        : outputDataset;
    },
  };
}
