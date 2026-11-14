import type { BaseIssue, BaseSchema, BaseSchemaAsync } from '../types/index.js';
import { ValidationError } from '../utils/index.js';

/** Check native instance identity against this package ValidationError constructor; raw errors and their causes remain private.
 * @param {unknown} error - Unknown caught value; this does not inspect or serialize its message or submitted data.
 * @returns {boolean} Whether this exact constructor recognizes the value; other realm/package copies need not match.
 */
// @__NO_SIDE_EFFECTS__
export function isValidationError<
  TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(error: unknown): error is ValidationError<TSchema> {
  return error instanceof ValidationError;
}
