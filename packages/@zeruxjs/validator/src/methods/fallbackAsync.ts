import { _runSchema } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  Config,
  InferInput,
  InferIssue,
  InferOutput,
  MaybeDeepReadonly,
  MaybePromise,
  OutputDataset,
  StandardProps,
  UnknownDataset,
} from '../types/index.js';
import { _getStandardProps } from '../utils/index.js';
import { getFallback } from './getFallback.js';

/**
 * Fallback async type.
 */
export type FallbackAsync<
  TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> =
  | MaybeDeepReadonly<InferOutput<TSchema>>
  | ((
      dataset?: OutputDataset<InferOutput<TSchema>, InferIssue<TSchema>>,
      config?: Config<InferIssue<TSchema>>
    ) => MaybePromise<MaybeDeepReadonly<InferOutput<TSchema>>>);

/**
 * Schema with fallback async type.
 */
export type SchemaWithFallbackAsync<
  TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  TFallback extends FallbackAsync<TSchema>,
> = Omit<TSchema, 'async' | '~standard' | '~run'> & {
  /**
   * Trusted output literal/factory retained by reference; type compatibility is not runtime revalidation.
   */
  readonly fallback: TFallback;
  /**
   * Whether it's async.
   */
  readonly async: true;
  /**
   * The Standard Schema properties.
   *
   * @internal
   */
  readonly '~standard': StandardProps<
    InferInput<TSchema>,
    InferOutput<TSchema>
  >;
  /**
   * Parses unknown input values.
   *
   * @param {UnknownDataset} dataset - Current private input dataset.
   * @param {Config<BaseIssue<unknown>>} config - Root-derived private budgets and cooperative signal.
   *
   * @returns {Promise<OutputDataset<InferOutput<TSchema>, InferIssue<TSchema>>>>} Actual schema/factory settlement; replacement identity remains borrowed.
   *
   * @internal
   */
  readonly '~run': (
    dataset: UnknownDataset,
    config: Config<BaseIssue<unknown>>
  ) => Promise<OutputDataset<InferOutput<TSchema>, InferIssue<TSchema>>>;
};

/**
 * Replace ordinary schema rejection with an explicitly trusted fallback value/factory. Operational, cancellation and budget failures still propagate; the replacement is not revalidated by the wrapped schema.
 *
 * @param {TSchema} schema - Trusted declared schema whose ordinary issue result may select a fallback.
 * @param {TFallback} fallback - Trusted output-compatible literal/factory retained by reference, not arbitrary source code.
 *
 * @returns {SchemaWithFallbackAsync<TSchema, TFallback>} Inert fallback wrapper; literal/output identity is not deep-cloned.
 */
// @__NO_SIDE_EFFECTS__
export function fallbackAsync<
  const TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  const TFallback extends FallbackAsync<TSchema>,
>(
  schema: TSchema,
  fallback: TFallback
): SchemaWithFallbackAsync<TSchema, TFallback> {
  return {
    ...schema,
    fallback,
    async: true,
    get '~standard'() {
      return _getStandardProps(this);
    },
    async '~run'(dataset, config) {
      /** Completed schema dataset; only ordinary issues select replacement, never operational exceptions. */
      const outputDataset = await _runSchema(schema, dataset, config);
      return outputDataset.issues
        ? {
            typed: true,
            value: await getFallback(this, outputDataset, config),
          }
        : outputDataset;
    },
  };
}
