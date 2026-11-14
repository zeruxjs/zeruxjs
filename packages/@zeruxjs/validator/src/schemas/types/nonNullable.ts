import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  ErrorMessage,
  InferInput,
  InferIssue,
  InferOutput,
  NonNullable,
} from '../../types/index.js';
import type { UnionIssue } from './union.js';
import type { UnionOptions, UnionSchema } from '../union.js';
import type { UnionOptionsAsync, UnionSchemaAsync } from '../unionAsync.js';

/**
 * Non nullable issue interface.
 */
export interface NonNullableIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue category; raw inputs/messages are not sanitized here.
   */
  readonly kind: 'schema';
  /**
   * Stable exclusion issue discriminator used by declared output/issue inference.
   */
  readonly type: 'non_nullable';
  /**
   * Fixed private expectation for the excluded sentinel.
   */
  readonly expected: '!null';
}

/**
 * Infer wrapped input excluding only null; undefined still follows the wrapped schema.
 */
export type InferNonNullableInput<
  TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> = NonNullable<InferInput<TWrapped>>;

/**
 * Infer transformed output excluding only null; undefined still follows the wrapped schema.
 */
export type InferNonNullableOutput<
  TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> = NonNullable<InferOutput<TWrapped>>;

/**
 * Preserve wrapped issue inference while excluding sentinel-only issues and recursively rebuilding union issue types.
 */
export type InferNonNullableIssue<
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
      | Exclude<InferIssue<TWrapped>, { type: 'null' | 'union' }>
      | UnionIssue<InferNonNullableIssue<TWrapped['options'][number]>>
  : Exclude<InferIssue<TWrapped>, { type: 'null' }>;
