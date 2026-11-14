import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  DefaultAsync,
  DefaultValue,
  InferOutput,
} from '../../types/index.js';

/**
 * Infer wrapped output plus the permitted undefined sentinel after the declared default policy.
 * This is type-only inference: factories execute in the wrapper, ordinary replacements are validated there, and this alias performs no cloning or validation.
 */
export type InferUndefinedableOutput<
  TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  TDefault extends DefaultAsync<TWrapped, undefined>,
> = undefined extends TDefault
  ? InferOutput<TWrapped> | undefined
  : InferOutput<TWrapped> | Extract<DefaultValue<TDefault>, undefined>;
