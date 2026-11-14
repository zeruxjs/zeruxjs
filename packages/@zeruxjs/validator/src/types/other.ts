import type { Config } from './config.js';
import type { UnknownDataset } from './dataset.js';
import type { InferInput, InferIssue } from './infer.js';
import type { BaseIssue } from './issue.js';
import type { BaseSchema, BaseSchemaAsync } from './schema.js';
import type { MaybeDeepReadonly, MaybePromise } from './utils.js';

/**
 * Trusted private diagnostic text or synchronous issue callback. Raw issue values may be sensitive; this type grants no HTML/HTTP escaping or authorization.
 */
export type ErrorMessage<TIssue extends BaseIssue<unknown>> =
  | ((issue: TIssue) => string)
  | string;

/**
 * Trusted synchronous input-default literal/factory, including the wrapper’s sentinel. Non-sentinel replacement still undergoes wrapped validation; literals are not deep-cloned.
 */
export type Default<
  TWrapped extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TInput extends null | undefined,
> =
  | MaybeDeepReadonly<InferInput<TWrapped> | TInput>
  | ((
      dataset?: UnknownDataset,
      config?: Config<InferIssue<TWrapped>>
    ) => MaybeDeepReadonly<InferInput<TWrapped> | TInput>)
  | undefined;

/**
 * Trusted asynchronous input-default literal/factory contract. Async wrappers await settlement; factory-created work remains host-owned and cooperative.
 */
export type DefaultAsync<
  TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  TInput extends null | undefined,
> =
  | MaybeDeepReadonly<InferInput<TWrapped> | TInput>
  | ((
      dataset?: UnknownDataset,
      config?: Config<InferIssue<TWrapped>>
    ) => MaybePromise<MaybeDeepReadonly<InferInput<TWrapped> | TInput>>)
  | undefined;

/**
 * Infer a literal default or awaited factory output at compile time. This helper does not execute a factory, await work or validate a replacement.
 */
export type DefaultValue<
  TDefault extends
    | Default<
        BaseSchema<unknown, unknown, BaseIssue<unknown>>,
        null | undefined
      >
    | DefaultAsync<
        | BaseSchema<unknown, unknown, BaseIssue<unknown>>
        | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
        null | undefined
      >,
> =
  TDefault extends DefaultAsync<
    infer TWrapped extends
      | BaseSchema<unknown, unknown, BaseIssue<unknown>>
      | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
    infer TInput
  >
    ? TDefault extends (
        dataset?: UnknownDataset,
        config?: Config<InferIssue<TWrapped>>
      ) => MaybePromise<MaybeDeepReadonly<InferInput<TWrapped> | TInput>>
      ? Awaited<ReturnType<TDefault>>
      : TDefault
    : never;
