import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  DefaultAsync,
  DefaultValue,
  InferOutput,
} from '../../types/index.js';

/**
 * Infer nullish output type.
 */
export type InferNullishOutput<
  TWrapped extends
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  TDefault extends DefaultAsync<TWrapped, null | undefined>,
> = undefined extends TDefault
  ? InferOutput<TWrapped> | null | undefined
  : InferOutput<TWrapped> | Extract<DefaultValue<TDefault>, null | undefined>;
