import { _runSchema } from '../utils/_run.js';
import type {
  LooseTupleIssue,
  LooseTupleSchema,
  StrictTupleIssue,
  StrictTupleSchema,
  TupleIssue,
  TupleSchema,
  TupleWithRestIssue,
  TupleWithRestSchema,
} from '../schemas/index.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseTransformation,
  ErrorMessage,
  InferInput,
  TupleItems,
} from '../types/index.js';
import { ValidationError } from '../utils/index.js';

/**
 * Schema type.
 */
type Schema =
  | LooseTupleSchema<TupleItems, ErrorMessage<LooseTupleIssue> | undefined>
  | StrictTupleSchema<TupleItems, ErrorMessage<StrictTupleIssue> | undefined>
  | TupleSchema<TupleItems, ErrorMessage<TupleIssue> | undefined>
  | TupleWithRestSchema<
      TupleItems,
      BaseSchema<unknown, unknown, BaseIssue<unknown>>,
      ErrorMessage<TupleWithRestIssue> | undefined
    >;

/**
 * Args action type.
 */
export interface ArgsAction<
  TInput extends (...args: any[]) => unknown,
  TSchema extends Schema,
> extends BaseTransformation<
  TInput,
  (...args: InferInput<TSchema>) => ReturnType<TInput>,
  never
> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'args';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof args;
  /**
   * The arguments schema.
   */
  readonly schema: TSchema;
}

/** Wrap an explicitly supplied function so tuple arguments validate before invocation; bind host methods first because the wrapper uses a plain call. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TSchema} schema - Borrowed explicit argument/result schema; returned callables retain the captured configuration and create no fresh request authorization boundary.
 * @returns {ArgsAction<TInput, TSchema>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function args<
  TInput extends (...args: any[]) => unknown,
  TSchema extends Schema,
>(schema: TSchema): ArgsAction<TInput, TSchema>;

/** Wrap an explicitly supplied function so tuple arguments validate before invocation; bind host methods first because the wrapper uses a plain call. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {Schema} schema - Borrowed explicit argument/result schema; returned callables retain the captured configuration and create no fresh request authorization boundary.
 * @returns {ArgsAction<(...args: unknown[]) => unknown, Schema>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function args(
  schema: Schema
): ArgsAction<(...args: unknown[]) => unknown, Schema> {
  return {
    kind: 'transformation',
    type: 'args',
    reference: args,
    async: false,
    schema,
    /** Wrap an explicitly supplied function so tuple arguments validate before invocation; bind host methods first because the wrapper uses a plain call. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      /** Borrowed explicit function, called as a plain function only when the returned wrapper is invoked; no candidate string is evaluated. */
      const func = dataset.value;
      // Capture the existing root configuration, including its execution mode/budgets; this is not fresh per-request authorization.
      dataset.value = (...args_) => {
        /** Validated/transformed argument tuple; ordinary issues throw before invoking the borrowed function. */
        const argsDataset = _runSchema(this.schema, { value: args_ }, config);
        if (argsDataset.issues) {
          throw new ValidationError(argsDataset.issues);
        }
        return func(...argsDataset.value);
      };
      return dataset;
    },
  };
}
