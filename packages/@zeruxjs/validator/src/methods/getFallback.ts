import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  Config,
  InferIssue,
  InferOutput,
  MaybeDeepReadonly,
  MaybePromise,
  OutputDataset,
} from '../types/index.js';
import type { SchemaWithFallback } from './fallback.js';
import type { SchemaWithFallbackAsync } from './fallbackAsync.js';

/**
 * Infer fallback type.
 */
export type InferFallback<
  TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> = TSchema extends
  | SchemaWithFallback<
      BaseSchema<unknown, unknown, BaseIssue<unknown>>,
      infer TFallback
    >
  | SchemaWithFallbackAsync<
      | BaseSchema<unknown, unknown, BaseIssue<unknown>>
      | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
      infer TFallback
    >
  ? TFallback extends MaybeDeepReadonly<InferOutput<TSchema>>
    ? TFallback
    : TFallback extends () => MaybePromise<
          MaybeDeepReadonly<InferOutput<TSchema>>
        >
      ? ReturnType<TFallback>
      : never
  : undefined;

/**
 * Read a trusted fallback literal or invoke its declared factory with optional private dataset/config. This is explicit callback execution, not source evaluation or output revalidation.
 *
 * @param {TSchema} schema - Trusted schema wrapper whose fallback is a literal or application callback.
 * @param {OutputDataset<InferOutput<TSchema>, InferIssue<TSchema>>} dataset - Optional private ordinary-failure dataset passed to the trusted factory.
 * @param {Config<InferIssue<TSchema>>} config - Optional root execution context; factories own any additional work they start.
 *
 * @returns {InferFallback<TSchema>} Borrowed literal or actual factory result; async wrappers await it and factory failures propagate.
 */
// @__NO_SIDE_EFFECTS__
export function getFallback<
  const TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(
  schema: TSchema,
  dataset?: OutputDataset<InferOutput<TSchema>, InferIssue<TSchema>>,
  config?: Config<InferIssue<TSchema>>
): InferFallback<TSchema> {
  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
  return typeof schema.fallback === 'function'
    ? // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      schema.fallback(dataset, config)
    : // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      schema.fallback;
}
