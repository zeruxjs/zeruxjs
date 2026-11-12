import { executeSchemaAsync } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  Config,
  InferIssue,
  InferOutput,
} from '../types/index.js';
import { ValidationError } from '../utils/index.js';

/**
 * Parse input under per-call budgets, throwing ValidationError only for ordinary schema issues; operational failures preserve their own errors.
 *
 * @param {TSchema} schema - Trusted declared schema; callbacks are not sandboxed.
 * @param {unknown} input - Candidate bounded input scanned before schema execution; structural output is not a guaranteed deep clone.
 * @param {Config<InferIssue<TSchema>>} config - Optional per-call execution limits, cancellation and synchronous value-free hooks.
 *
 * @returns {Promise<InferOutput<TSchema>>} Validated/transformed output; exceptions and asynchronous misuse are not converted to fallback data.
 */
export async function parseAsync<
  const TSchema extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(
  schema: TSchema,
  input: unknown,
  config?: Config<InferIssue<TSchema>>
): Promise<InferOutput<TSchema>> {
  /** Per-call execution dataset; shared budgets and async cleanup complete before exposing a result. */
  const dataset = await executeSchemaAsync(schema, input, config);
  if (dataset.issues) {
    throw new ValidationError(dataset.issues);
  }
  return dataset.value;
}
