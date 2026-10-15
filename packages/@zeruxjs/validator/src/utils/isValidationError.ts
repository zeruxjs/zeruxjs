import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
} from '../types/index.js';
import { ValidationError } from '../utils/index.js';

/**
 * A type guard to check if an error is a ValidationError.
 *
 * @param error The error to check.
 *
 * @returns Whether its a ValidationError.
 */
// @__NO_SIDE_EFFECTS__
export function isValidationError<
  TSchema extends
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(error: unknown): error is ValidationError<TSchema> {
  return error instanceof ValidationError;
}
