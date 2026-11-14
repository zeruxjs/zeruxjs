import { executeSchema } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  Config,
  InferIssue,
} from '../types/index.js';
import type { SafeParseResult } from './types/safeParse.js';

/**
 * Return a typed validation outcome under per-call budgets; operational, cancellation, hook and budget failures still throw.
 *
 * @param {TSchema} schema - Trusted declared schema; callbacks are not sandboxed.
 * @param {unknown} input - Candidate bounded input scanned before schema execution; structural output is not a guaranteed deep clone.
 * @param {Config<InferIssue<TSchema>>} config - Optional per-call execution limits, cancellation and synchronous value-free hooks.
 *
 * @returns {SafeParseResult<TSchema>} Typed success/failure metadata; no partial success on budget exhaustion.
 */
// @__NO_SIDE_EFFECTS__
export function safeParse<
  const TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(
  schema: TSchema,
  input: unknown,
  config?: Config<InferIssue<TSchema>>
): SafeParseResult<TSchema> {
  /** Per-call execution dataset; shared budgets and async cleanup complete before exposing a result. */
  const dataset = executeSchema(schema, input, config);
  return {
    typed: dataset.typed,
    success: !dataset.issues,
    output: dataset.value,
    issues: dataset.issues,
  } as SafeParseResult<TSchema>;
}
