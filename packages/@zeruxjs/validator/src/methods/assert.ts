import { executeSchema } from '../utils/_run.js';
import type { BaseIssue, BaseSchema, InferInput } from '../types/index.js';
import { ValidationError } from '../utils/index.js';

/**
 * Checks if the input matches the schema. As this is an assertion function, it
 * can be used as a type guard.
 *
 * @param {TSchema} schema - Trusted explicitly synchronous schema; async misuse still rejects.
 * @param {unknown} input - Candidate input scanned within default per-parse execution limits.
 * @returns {void} Completes for valid input; ordinary issues throw ValidationError, other failures retain their error class.
 */
export function assert<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(schema: TSchema, input: unknown): asserts input is InferInput<TSchema> {
  /** First-failure raw issue list from the shared bounded synchronous execution path. */
  const issues = executeSchema(schema, input, { abortEarly: true }).issues;
  if (issues) {
    throw new ValidationError(issues);
  }
}
