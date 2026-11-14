import { _runSchema } from '../utils/_run.js';
import type {
  ArrayPathItem,
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  InferInput,
  InferIssue,
  InferOutput,
  InferTupleInput,
  InferTupleIssue,
  InferTupleOutput,
  OutputDataset,
  TupleItems,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';
import type { TupleWithRestIssue } from './types/tupleWithRest.js';

/**
 * Tuple with rest schema interface.
 */
export interface TupleWithRestSchema<
  TItems extends TupleItems,
  TRest extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TMessage extends ErrorMessage<TupleWithRestIssue> | undefined,
> extends BaseSchema<
  [...InferTupleInput<TItems>, ...InferInput<TRest>[]],
  [...InferTupleOutput<TItems>, ...InferOutput<TRest>[]],
  TupleWithRestIssue | InferTupleIssue<TItems> | InferIssue<TRest>
> {
  /**
   * Fixed structural discriminator used by issue and metadata consumers.
   */
  readonly type: 'tuple_with_rest';
  /**
   * Authored constructor identity; no package discovery or source evaluation occurs.
   */
  readonly reference: typeof tupleWithRest;
  /**
   * Private root-type diagnostic, not an authorization or escaping policy.
   */
  readonly expects: 'Array';
  /**
   * Borrowed ordered child schemas; not a copied or frozen tuple.
   */
  readonly items: TItems;
  /**
   * Borrowed explicit child schema for accepted extra values.
   */
  readonly rest: TRest;
  /**
   * Optional trusted private diagnostic text/callback; raw issues can contain rejected values.
   */
  readonly message: TMessage;
}

/** Validate the declared positional prefix and validate trailing items against the explicit rest schema. Construction captures trusted references; root parsing owns execution limits.
 * @param {TItems} items - Borrowed trusted ordered child schemas; missing positions are delegated as undefined.
 * @param {TRest} rest - Borrowed explicit child schema for extra values; it receives the same root budget and private issue policy.
 * @returns {TupleWithRestSchema<TItems, TRest, undefined>} Inert structured schema; no input is parsed, cloned or authorized during construction.
 */
export function tupleWithRest<
  const TItems extends TupleItems,
  const TRest extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(items: TItems, rest: TRest): TupleWithRestSchema<TItems, TRest, undefined>;

/** Validate the declared positional prefix and validate trailing items against the explicit rest schema. Construction captures trusted references; root parsing owns execution limits.
 * @param {TItems} items - Borrowed trusted ordered child schemas; missing positions are delegated as undefined.
 * @param {TRest} rest - Borrowed explicit child schema for extra values; it receives the same root budget and private issue policy.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; not client-safe HTML.
 * @returns {TupleWithRestSchema<TItems, TRest, TMessage>} Inert structured schema; no input is parsed, cloned or authorized during construction.
 */
export function tupleWithRest<
  const TItems extends TupleItems,
  const TRest extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TMessage extends ErrorMessage<TupleWithRestIssue> | undefined,
>(
  items: TItems,
  rest: TRest,
  message: TMessage
): TupleWithRestSchema<TItems, TRest, TMessage>;

/** Validate the declared positional prefix and validate trailing items against the explicit rest schema. Construction captures trusted references; root parsing owns execution limits.
 * @param {TupleItems} items - Borrowed trusted ordered child schemas; missing positions are delegated as undefined.
 * @param {BaseSchema<unknown, unknown, BaseIssue<unknown>>} rest - Borrowed explicit child schema for extra values; it receives the same root budget and private issue policy.
 * @param {ErrorMessage<TupleWithRestIssue>} message - Optional trusted private diagnostic text/callback; not client-safe HTML.
 * @returns {TupleWithRestSchema<TupleItems, BaseSchema<unknown, unknown, BaseIssue<unknown>>, ErrorMessage<TupleWithRestIssue> | undefined>} Inert structured schema; no input is parsed, cloned or authorized during construction.
 */
// @__NO_SIDE_EFFECTS__
export function tupleWithRest(
  items: TupleItems,
  rest: BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  message?: ErrorMessage<TupleWithRestIssue>
): TupleWithRestSchema<
  TupleItems,
  BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  ErrorMessage<TupleWithRestIssue> | undefined
> {
  return {
    kind: 'schema',
    type: 'tuple_with_rest',
    reference: tupleWithRest,
    expects: 'Array',
    async: false,
    items,
    rest,
    message,
    /** Adapt explicit validation to the shared bounded root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Validate the declared positional prefix and validate trailing items against the explicit rest schema. Child transforms may return borrowed identities; output is not a deep clone.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private current candidate; object keys are checked as own properties and tuple positions use array indices.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root work/issue budgets, abort flags and private message policy.
     * @returns {OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>} Declared structural output or private nested issues; exceptions and budget failures propagate.
     */
    '~run'(dataset, config) {
      // Get input value from dataset
      /** Borrowed current input retained for own-field checks and private issue paths. */
      const input = dataset.value;

      // If root type is valid, check nested types
      if (Array.isArray(input)) {
        // Set typed to `true` and value to empty array
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
        dataset.value = [];

        // Parse schema of each tuple item
        for (let key = 0; key < this.items.length; key++) {
          /** Current own field or positional value; missing input is delegated as undefined. */
          const value = input[key];
          // The loop bounds select an existing item from the trusted schema tuple.
          /** Current positional child result; issue rebasing and abort flags preserve source order. */
          const itemDataset = _runSchema(this.items[key]!, { value }, config);

          // If there are issues, capture them
          if (itemDataset.issues) {
            // Create tuple path item
            /** Private parent path segment retaining original input/value; public HTTP responses sanitize it. */
            const pathItem: ArrayPathItem = {
              type: 'array',
              origin: 'value',
              input,
              key,
              value,
            };

            // Add modified item dataset issues to issues
            for (const issue of itemDataset.issues) {
              if (issue.path) {
                issue.path.unshift(pathItem);
              } else {
                // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                issue.path = [pathItem];
              }
              // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
              dataset.issues?.push(issue);
            }
            if (!dataset.issues) {
              // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
              dataset.issues = itemDataset.issues;
            }

            // If necessary, abort early
            if (config.abortEarly) {
              dataset.typed = false;
              break;
            }
          }

          // If not typed, set typed to `false`
          if (!itemDataset.typed) {
            dataset.typed = false;
          }

          // Add item to dataset
          // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          dataset.value.push(itemDataset.value);
        }

        // Parse rest with schema if necessary
        if (!dataset.issues || !config.abortEarly) {
          for (let key = this.items.length; key < input.length; key++) {
            /** Current own field or positional value; missing input is delegated as undefined. */
            const value = input[key];
            /** Current positional child result; issue rebasing and abort flags preserve source order. */
            const itemDataset = _runSchema(this.rest, { value }, config);

            // If there are issues, capture them
            if (itemDataset.issues) {
              // Create tuple path item
              /** Private parent path segment retaining original input/value; public HTTP responses sanitize it. */
              const pathItem: ArrayPathItem = {
                type: 'array',
                origin: 'value',
                input,
                key,
                value,
              };

              // Add modified item dataset issues to issues
              for (const issue of itemDataset.issues) {
                if (issue.path) {
                  issue.path.unshift(pathItem);
                } else {
                  // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                  issue.path = [pathItem];
                }
                // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                dataset.issues?.push(issue);
              }
              if (!dataset.issues) {
                // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
                dataset.issues = itemDataset.issues;
              }

              // If necessary, abort early
              if (config.abortEarly) {
                dataset.typed = false;
                break;
              }
            }

            // If not typed, set typed to `false`
            if (!itemDataset.typed) {
              dataset.typed = false;
            }

            // Add item to dataset
            // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
            dataset.value.push(itemDataset.value);
          }
        }

        // Otherwise, add tuple issue
      } else {
        _addIssue(this, 'type', dataset, config);
      }

      // Return output dataset
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<
        unknown[],
        TupleWithRestIssue | BaseIssue<unknown>
      >;
    },
  };
}
