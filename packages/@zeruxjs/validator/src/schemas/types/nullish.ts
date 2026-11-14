import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  DefaultAsync,
  DefaultValue,
  InferOutput,
} from '../../types/index.js';

/**
 * Infer wrapped output plus the permitted null or undefined sentinel after the declared default policy.
 * This is type-only inference: factories execute in the wrapper, ordinary replacements are validated there, and this alias performs no cloning or validation.
 */
export type InferNullishOutput<
  TWrapped extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  TDefault extends DefaultAsync<TWrapped, null | undefined>,
> = undefined extends TDefault
  ? InferOutput<TWrapped> | null | undefined
  : InferOutput<TWrapped> | Extract<DefaultValue<TDefault>, null | undefined>;
