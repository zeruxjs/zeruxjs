import { executeSchema } from '../utils/_run.js';
import type { BaseIssue, BaseSchema, InferInput } from '../types/index.js';

/**
 * Checks if the input matches the schema. By using a type predicate, this
 * function can be used as a type guard.
 *
 * @param {TSchema} schema - Trusted explicitly synchronous schema; async misuse still rejects.
 * @param {unknown} input - Candidate input scanned within default per-parse execution limits.
 *
 * @returns {boolean} Whether validation is issue-free; budget/operational failures are not converted to false.
 */
// @__NO_SIDE_EFFECTS__
export function is<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(schema: TSchema, input: unknown): input is InferInput<TSchema> {
  return !executeSchema(schema, input, { abortEarly: true }).issues;
}
