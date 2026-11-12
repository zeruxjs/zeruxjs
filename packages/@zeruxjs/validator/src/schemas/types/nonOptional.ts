import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  ErrorMessage,
  InferInput,
  InferIssue,
  InferOutput,
  NonOptional,
} from '../../types/index.js';
import type { UnionIssue } from './union.js';
import type { UnionOptions, UnionSchema } from '../union.js';
import type { UnionOptionsAsync, UnionSchemaAsync } from '../unionAsync.js';

/**
 * Non optional issue interface.
 */
export interface NonOptionalIssue extends BaseIssue<unknown> {
  /**
   * Fixed schema issue category; raw inputs/messages are not sanitized here.
   */
  readonly kind: 'schema';
  /**
   * Stable exclusion issue discriminator used by declared output/issue inference.
   */
  readonly type: 'non_optional';
  /**
   * Fixed private expectation for the excluded sentinel.
   */
  readonly expected: '!undefined';
}

/**
 * Infer wrapped input excluding only undefined; null still follows the wrapped schema.
 */
export type InferNonOptionalInput<
  TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> = NonOptional<InferInput<TWrapped>>;

/**
 * Infer transformed output excluding only undefined; null still follows the wrapped schema.
 */
export type InferNonOptionalOutput<
  TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> = NonOptional<InferOutput<TWrapped>>;

/**
 * Preserve wrapped issue inference while excluding sentinel-only issues and recursively rebuilding union issue types.
 */
export type InferNonOptionalIssue<
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
      | Exclude<InferIssue<TWrapped>, { type: 'undefined' | 'union' }>
      | UnionIssue<InferNonOptionalIssue<TWrapped['options'][number]>>
  : Exclude<InferIssue<TWrapped>, { type: 'undefined' }>;
