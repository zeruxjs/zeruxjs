import { _runSchema } from '../utils/_run.js';
import type {
  LooseTupleIssue,
  LooseTupleSchema,
  LooseTupleSchemaAsync,
  StrictTupleIssue,
  StrictTupleSchema,
  StrictTupleSchemaAsync,
  TupleIssue,
  TupleSchema,
  TupleSchemaAsync,
  TupleWithRestIssue,
  TupleWithRestSchema,
  TupleWithRestSchemaAsync,
} from '../schemas/index.js';
import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  BaseTransformation,
  ErrorMessage,
  InferInput,
  SuccessDataset,
  TupleItems,
  TupleItemsAsync,
} from '../types/index.js';
import { ValidationError } from '../utils/index.js';

/**
 * Schema type.
 */
type Schema =
  | LooseTupleSchema<TupleItems, ErrorMessage<LooseTupleIssue> | undefined>
  | LooseTupleSchemaAsync<
      TupleItemsAsync,
      ErrorMessage<LooseTupleIssue> | undefined
    >
  | StrictTupleSchema<TupleItems, ErrorMessage<StrictTupleIssue> | undefined>
  | StrictTupleSchemaAsync<
      TupleItemsAsync,
      ErrorMessage<StrictTupleIssue> | undefined
    >
  | TupleSchema<TupleItems, ErrorMessage<TupleIssue> | undefined>
  | TupleSchemaAsync<TupleItemsAsync, ErrorMessage<TupleIssue> | undefined>
  | TupleWithRestSchema<
      TupleItems,
      BaseSchema<unknown, unknown, BaseIssue<unknown>>,
      ErrorMessage<TupleWithRestIssue> | undefined
    >
  | TupleWithRestSchemaAsync<
      TupleItemsAsync,
      | BaseSchema<unknown, unknown, BaseIssue<unknown>>
      | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
      ErrorMessage<TupleWithRestIssue> | undefined
    >;

/**
 * Args action async type.
 */
export interface ArgsActionAsync<
  TInput extends (...args: any[]) => unknown,
  TSchema extends Schema,
> extends BaseTransformation<
  TInput,
  (...args: InferInput<TSchema>) => Promise<Awaited<ReturnType<TInput>>>,
  never
> {
  /**
   * Stable declared refinement/transformation discriminator.
   */
  readonly type: 'args';
  /**
   * Authored constructor identity; never loaded from a candidate string.
   */
  readonly reference: typeof argsAsync;
  /**
   * The arguments schema.
   */
  readonly schema: TSchema;
}

/** Create a synchronous wrapper descriptor whose callable awaits tuple argument validation; async child schemas require wrapper creation through an async root parse. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {TSchema} schema - Borrowed explicit argument/result schema; returned callables retain the captured configuration and create no fresh request authorization boundary.
 * @returns {ArgsActionAsync<TInput, TSchema>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
export function argsAsync<
  TInput extends (...args: any[]) => unknown,
  TSchema extends Schema,
>(schema: TSchema): ArgsActionAsync<TInput, TSchema>;

/** Create a synchronous wrapper descriptor whose callable awaits tuple argument validation; async child schemas require wrapper creation through an async root parse. Construction captures trusted callbacks/paths without evaluating candidate data.
 * @param {Schema} schema - Borrowed explicit argument/result schema; returned callables retain the captured configuration and create no fresh request authorization boundary.
 * @returns {ArgsActionAsync<(...args: unknown[]) => unknown, Schema>} Structured action with its declared validation/transformation behavior; no resource-disposal owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function argsAsync(
  schema: Schema
): ArgsActionAsync<(...args: unknown[]) => unknown, Schema> {
  return {
    kind: 'transformation',
    type: 'args',
    reference: argsAsync,
    async: false,
    schema,
    /** Create a synchronous wrapper descriptor whose callable awaits tuple argument validation; async child schemas require wrapper creation through an async root parse. Host callback/property exceptions propagate.
     * @param {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} dataset - Private dataset; input admission and pipeline typing belong to the owning schema.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root issue budget, abort flags and private message policy.
     * @returns {import('../types/index.js').OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Dataset with declared output or private issues; this is not escaping, authorization or rollback.
     */
    '~run'(dataset, config) {
      /** Borrowed explicit function, called as a plain function only when the returned wrapper is invoked; no candidate string is evaluated. */
      const func = dataset.value;
      // Capture the existing root configuration, including its execution mode/budgets; this is not fresh per-request authorization.
      dataset.value = async (...args) => {
        /** Validated/transformed argument tuple; ordinary issues throw before invoking the borrowed function. */
        const argsDataset = await _runSchema(schema, { value: args }, config);
        if (argsDataset.issues) {
          throw new ValidationError(argsDataset.issues);
        }
        return func(...argsDataset.value);
      };
      return dataset as SuccessDataset<
        (...args: unknown[]) => Promise<unknown>
      >;
    },
  };
}
