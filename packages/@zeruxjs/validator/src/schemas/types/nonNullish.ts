import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  ErrorMessage,
  InferInput,
  InferIssue,
  InferOutput,
  NonNullish,
} from '../../types/index.js';
import type { UnionIssue } from './union.js';
import type { UnionOptions, UnionSchema } from '../union.js';
import type { UnionOptionsAsync, UnionSchemaAsync } from '../unionAsync.js';

/**
 * Non nullish issue interface.
 */
export interface NonNullishIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue category; raw inputs/messages are not sanitized here.
   */
  readonly kind: 'schema';
  /**
   * Stable exclusion issue discriminator used by declared output/issue inference.
   */
  readonly type: 'non_nullish';
  /**
   * Fixed private expectation for the excluded sentinel.
   */
  readonly expected: '(!null & !undefined)';
}

/**
 * Infer wrapped input excluding both null and undefined.
 */
export type InferNonNullishInput<
  TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> = NonNullish<InferInput<TWrapped>>;

/**
 * Infer transformed output excluding both null and undefined.
 */
export type InferNonNullishOutput<
  TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> = NonNullish<InferOutput<TWrapped>>;

/**
 * Preserve wrapped issue inference while excluding sentinel-only issues and recursively rebuilding union issue types.
 */
export type InferNonNullishIssue<
  TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> = TWrapped extends
  | UnionSchema<
      UnionOptions,
      ErrorMessage<UnionIssue<BaseIssue<unknown>>> | undefined
    >
  | UnionSchemaAsync<
      UnionOptionsAsync,
      ErrorMessage<UnionIssue<BaseIssue<unknown>>> | undefined
    >
  ?
      | Exclude<InferIssue<TWrapped>, { type: 'null' | 'undefined' | 'union' }>
      | UnionIssue<InferNonNullishIssue<TWrapped['options'][number]>>
  : Exclude<InferIssue<TWrapped>, { type: 'null' | 'undefined' }>;
