import type { InferInput, InferIssue, InferOutput } from './infer.js';
import type { BaseIssue } from './issue.js';
import type { BaseSchema, BaseSchemaAsync } from './schema.js';
import type { MaybeReadonly } from './utils.js';

/** Borrowed ordered synchronous child schemas; readonly typing is not runtime freezing. */
export type TupleItems = MaybeReadonly<
  BaseSchema<unknown, unknown, BaseIssue<unknown>>[]
>;

/** Borrowed ordered explicitly synchronous/asynchronous child schemas. */
export type TupleItemsAsync = MaybeReadonly<
  (
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
  )[]
>;

/** Infer ordered child input positions, removing only type-level readonly modifiers. */
export type InferTupleInput<TItems extends TupleItems | TupleItemsAsync> = {
  -readonly [TKey in keyof TItems]: InferInput<TItems[TKey]>;
};

/** Infer ordered transformed output positions without cloning runtime values. */
export type InferTupleOutput<TItems extends TupleItems | TupleItemsAsync> = {
  -readonly [TKey in keyof TItems]: InferOutput<TItems[TKey]>;
};

/** Collect possible private issue types across declared tuple children. */
export type InferTupleIssue<TItems extends TupleItems | TupleItemsAsync> =
  InferIssue<TItems[number]>;
