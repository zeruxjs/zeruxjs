import { _runSchema } from '../utils/_run.js';
import type {
  ArrayPathItem,
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  InferTupleInput,
  InferTupleIssue,
  InferTupleOutput,
  OutputDataset,
  TupleItems,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';
import type { LooseTupleIssue } from './types/looseTuple.js';

/**
 * Loose tuple schema interface.
 */
export interface LooseTupleSchema<
  TItems extends TupleItems,
  TMessage extends ErrorMessage<LooseTupleIssue> | undefined,
> extends BaseSchema<
  [...InferTupleInput<TItems>, ...unknown[]],
  [...InferTupleOutput<TItems>, ...unknown[]],
  LooseTupleIssue | InferTupleIssue<TItems>
> {
  /**
   * Fixed structural discriminator used by issue and metadata consumers.
   */
  readonly type: 'loose_tuple';
  /**
   * Authored constructor identity; no package discovery or source evaluation occurs.
   */
  readonly reference: typeof looseTuple;
  /**
   * Private root-type diagnostic, not an authorization or escaping policy.
   */
  readonly expects: 'Array';
  /**
   * Borrowed ordered child schemas; not a copied or frozen tuple.
   */
  readonly items: TItems;
  /**
   * Optional trusted private diagnostic text/callback; raw issues can contain rejected values.
   */
  readonly message: TMessage;
}

/** Validate the declared positional prefix and retain trailing values without validating them. Construction captures trusted references; root parsing owns execution limits.
 * @param {TItems} items - Borrowed trusted ordered child schemas; missing positions are delegated as undefined.
 * @returns {LooseTupleSchema<TItems, undefined>} Inert structured schema; no input is parsed, cloned or authorized during construction.
 */
export function looseTuple<const TItems extends TupleItems>(
  items: TItems
): LooseTupleSchema<TItems, undefined>;

/** Validate the declared positional prefix and retain trailing values without validating them. Construction captures trusted references; root parsing owns execution limits.
 * @param {TItems} items - Borrowed trusted ordered child schemas; missing positions are delegated as undefined.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; not client-safe HTML.
 * @returns {LooseTupleSchema<TItems, TMessage>} Inert structured schema; no input is parsed, cloned or authorized during construction.
 */
export function looseTuple<
  const TItems extends TupleItems,
  const TMessage extends ErrorMessage<LooseTupleIssue> | undefined,
>(items: TItems, message: TMessage): LooseTupleSchema<TItems, TMessage>;

/** Validate the declared positional prefix and retain trailing values without validating them. Construction captures trusted references; root parsing owns execution limits.
 * @param {TupleItems} items - Borrowed trusted ordered child schemas; missing positions are delegated as undefined.
 * @param {ErrorMessage<LooseTupleIssue>} message - Optional trusted private diagnostic text/callback; not client-safe HTML.
 * @returns {LooseTupleSchema<TupleItems, ErrorMessage<LooseTupleIssue> | undefined>} Inert structured schema; no input is parsed, cloned or authorized during construction.
 */
// @__NO_SIDE_EFFECTS__
export function looseTuple(
  items: TupleItems,
  message?: ErrorMessage<LooseTupleIssue>
): LooseTupleSchema<TupleItems, ErrorMessage<LooseTupleIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'loose_tuple',
    reference: looseTuple,
    expects: 'Array',
    async: false,
    items,
    message,
    /** Adapt explicit validation to the shared bounded root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Validate the declared positional prefix and retain trailing values without validating them. Child transforms may return borrowed identities; output is not a deep clone.
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

        // Add rest to dataset if necessary
        if (!dataset.issues || !config.abortEarly) {
          for (let key = this.items.length; key < input.length; key++) {
            // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
            dataset.value.push(input[key]);
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
        LooseTupleIssue | BaseIssue<unknown>
      >;
    },
  };
}
