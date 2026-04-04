/* eslint-disable @typescript-eslint/no-explicit-any */
import type { BaseIssue } from './issue.js';
import type { BaseMetadata } from './metadata.js';
import type { BaseSchema, BaseSchemaAsync } from './schema.js';
import type {
  BaseTransformation,
  BaseTransformationAsync,
} from './transformation.js';
import type { BaseValidation, BaseValidationAsync } from './validation.js';

/**
 * Infer input type.
 */
export type InferInput<
  TItem extends
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
  | BaseValidation<any, unknown, BaseIssue<unknown>>
  | BaseValidationAsync<any, unknown, BaseIssue<unknown>>
  | BaseTransformation<any, unknown, BaseIssue<unknown>>
  | BaseTransformationAsync<any, unknown, BaseIssue<unknown>>
  | BaseMetadata<any>,
> = NonNullable<TItem['~types']>['input'];

/**
 * Infer output type.
 */
export type InferOutput<
  TItem extends
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
  | BaseValidation<any, unknown, BaseIssue<unknown>>
  | BaseValidationAsync<any, unknown, BaseIssue<unknown>>
  | BaseTransformation<any, unknown, BaseIssue<unknown>>
  | BaseTransformationAsync<any, unknown, BaseIssue<unknown>>
  | BaseMetadata<any>,
> = NonNullable<TItem['~types']>['output'];

/**
 * Infer issue type.
 */
export type InferIssue<
  TItem extends
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>
  | BaseValidation<any, unknown, BaseIssue<unknown>>
  | BaseValidationAsync<any, unknown, BaseIssue<unknown>>
  | BaseTransformation<any, unknown, BaseIssue<unknown>>
  | BaseTransformationAsync<any, unknown, BaseIssue<unknown>>
  | BaseMetadata<any>,
> = NonNullable<TItem['~types']>['issue'];
