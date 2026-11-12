import { _runSchema } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseTransformation,
  InferOutput,
} from '../types/index.js';
import { ValidationError } from '../utils/index.js';

/**
 * Returns action type.
 */
export interface ReturnsAction<
  TInput extends (...args: any[]) => unknown,
  TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
> extends BaseTransformation<
  TInput,
  (...args: Parameters<TInput>) => InferOutput<TSchema>,
  never
> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'returns';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof returns;
  /**
   * The arguments schema.
   */
  readonly schema: TSchema;
}

/** Wrap an explicit function and validate its result after execution; validation failure cannot undo the function side effects. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TSchema} schema - Borrowed explicit argument/result schema; returned callables retain the captured configuration and create no fresh request authorization boundary.
 * @returns {ReturnsAction<TInput, TSchema>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function returns<
  TInput extends (...args: any[]) => unknown,
  TSchema extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(schema: TSchema): ReturnsAction<TInput, TSchema>;

/** Wrap an explicit function and validate its result after execution; validation failure cannot undo the function side effects. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {BaseSchema<unknown, unknown, BaseIssue<unknown>>} schema - Borrowed explicit argument/result schema; returned callables retain the captured configuration and create no fresh request authorization boundary.
 * @returns {ReturnsAction<(...args: unknown[]) => unknown, BaseSchema<unknown, unknown, BaseIssue<unknown>>>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function returns(
  schema: BaseSchema<unknown, unknown, BaseIssue<unknown>>
): ReturnsAction<
  (...args: unknown[]) => unknown,
  BaseSchema<unknown, unknown, BaseIssue<unknown>>
> {
  return {
    kind: 'transformation',
    type: 'returns',
    reference: returns,
    async: false,
    schema,
    /** Wrap an explicit function and validate its result after execution; validation failure cannot undo the function side effects. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      /** Borrowed explicit function, called as a plain function only when the returned wrapper is invoked; no candidate string is evaluated. */
      const func = dataset.value;
      // Capture the existing root configuration, including its execution mode/budgets; this is not fresh per-request authorization.
      dataset.value = (...args_) => {
        /** Validated function result after any host side effects have already occurred; issues cannot roll back those effects. */
        const returnsDataset = _runSchema(
          this.schema,
          { value: func(...args_) },
          config
        );
        if (returnsDataset.issues) {
          throw new ValidationError(returnsDataset.issues);
        }
        return returnsDataset.value;
      };
      return dataset;
    },
  };
}
