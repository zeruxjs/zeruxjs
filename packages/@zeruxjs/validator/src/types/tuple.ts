import type { InferInput, InferIssue, InferOutput } from './infer.js';
import type { BaseIssue } from './issue.js';
import type { BaseSchema, BaseSchemaAsync } from './schema.js';
import type { MaybeReadonly } from './utils.js';

/**
 * Tuple items type.
 */
export type TupleItems = MaybeReadonly<
  BaseSchema<unknown, unknown, BaseIssue<unknown>>[]
>;

/**
 * Tuple items async type.
 */
export type TupleItemsAsync = MaybeReadonly<
  (
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
  )[]
>;

/**
 * Infer tuple input type.
 */
export type InferTupleInput<TItems extends TupleItems | TupleItemsAsync> = {
  -readonly [TKey in keyof TItems]: InferInput<TItems[TKey]>;
};

/**
 * Infer tuple output type.
 */
export type InferTupleOutput<TItems extends TupleItems | TupleItemsAsync> = {
  -readonly [TKey in keyof TItems]: InferOutput<TItems[TKey]>;
};

/**
 * Infer tuple issue type.
 */
export type InferTupleIssue<TItems extends TupleItems | TupleItemsAsync> =
  InferIssue<TItems[number]>;
