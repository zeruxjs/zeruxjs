import type { BaseIssue } from './issue.js';
import type { BaseMetadata } from './metadata.js';
import type { BaseSchema, BaseSchemaAsync } from './schema.js';
import type {
  BaseTransformation,
  BaseTransformationAsync,
} from './transformation.js';
import type { BaseValidation, BaseValidationAsync } from './validation.js';

/**
 * Pipe action type.
 */
export type PipeAction<TInput, TOutput, TIssue extends BaseIssue<unknown>> =
  | BaseValidation<TInput, TOutput, TIssue>
  | BaseTransformation<TInput, TOutput, TIssue>
  | BaseMetadata<TInput>;

/**
 * Pipe action async type.
 */
export type PipeActionAsync<
  TInput,
  TOutput,
  TIssue extends BaseIssue<unknown>,
> =
  | BaseValidationAsync<TInput, TOutput, TIssue>
  | BaseTransformationAsync<TInput, TOutput, TIssue>;

/**
 * Pipe item type.
 */
export type PipeItem<TInput, TOutput, TIssue extends BaseIssue<unknown>> =
  | BaseSchema<TInput, TOutput, TIssue>
  | PipeAction<TInput, TOutput, TIssue>;

/**
 * Pipe item async type.
 */
export type PipeItemAsync<TInput, TOutput, TIssue extends BaseIssue<unknown>> =
  | BaseSchemaAsync<TInput, TOutput, TIssue>
  | PipeActionAsync<TInput, TOutput, TIssue>;

/** Exclude an attached pipeline at the type level for structural copy helpers; no runtime inspection is performed. */
export type SchemaWithoutPipe<
  TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> = TSchema & {
  /** Type-only exclusion marker for structural helpers; no runtime pipeline is allocated. */
  pipe?: never;
};

/**
 * Generic pipe action type.
 */
export type GenericPipeAction<
  TInput = any,
  TOutput = TInput,
  TIssue extends BaseIssue<unknown> = BaseIssue<unknown>,
> = PipeAction<TInput, TOutput, TIssue>;

/**
 * Generic pipe action async type.
 */
export type GenericPipeActionAsync<
  TInput = any,
  TOutput = TInput,
  TIssue extends BaseIssue<unknown> = BaseIssue<unknown>,
> = PipeActionAsync<TInput, TOutput, TIssue>;

/**
 * Generic pipe item type.
 */
export type GenericPipeItem<
  TInput = any,
  TOutput = TInput,
  TIssue extends BaseIssue<unknown> = BaseIssue<unknown>,
> = PipeItem<TInput, TOutput, TIssue>;

/**
 * Generic pipe item async type.
 */
export type GenericPipeItemAsync<
  TInput = any,
  TOutput = TInput,
  TIssue extends BaseIssue<unknown> = BaseIssue<unknown>,
> = PipeItemAsync<TInput, TOutput, TIssue>;
