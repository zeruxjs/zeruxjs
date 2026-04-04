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
import type {
    UnionIssue,
} from './union.js';
import type {
    UnionOptions,
    UnionSchema,
} from '../union.js';
import type {
    UnionOptionsAsync,
    UnionSchemaAsync,
} from '../unionAsync.js';

/**
 * Non nullable issue interface.
 */
export interface NonNullableIssue extends BaseIssue<unknown> {
    /**
     * The issue kind.
     */
    readonly kind: 'schema';
    /**
     * The issue type.
     */
    readonly type: 'non_nullable';
    /**
     * The expected property.
     */
    readonly expected: '!null';
}

/**
 * Infer non nullable input type.
 */
export type InferNonNullableInput<
    TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> = NonNullable<InferInput<TWrapped>>;

/**
 * Infer non nullable output type.
 */
export type InferNonNullableOutput<
    TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> = NonNullable<InferOutput<TWrapped>>;

/**
 * Infer non nullable issue type.
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
