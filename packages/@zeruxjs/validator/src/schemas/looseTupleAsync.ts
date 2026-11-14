import { _runSchema } from '../utils/_run.js';
import type {
  ArrayPathItem,
  BaseIssue,
  BaseSchemaAsync,
  ErrorMessage,
  InferTupleInput,
  InferTupleIssue,
  InferTupleOutput,
  OutputDataset,
  TupleItemsAsync,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';
import type { looseTuple } from './looseTuple.js';
import type { LooseTupleIssue } from './types/looseTuple.js';

/**
 * Loose tuple schema async interface.
 */
export interface LooseTupleSchemaAsync<
  TItems extends TupleItemsAsync,
  TMessage extends ErrorMessage<LooseTupleIssue> | undefined,
> extends BaseSchemaAsync<
  [...InferTupleInput<TItems>, ...unknown[]],
  [...InferTupleOutput<TItems>, ...unknown[]],
  LooseTupleIssue | InferTupleIssue<TItems>
> {
  /**
   * Stable structural discriminator for issue and metadata consumers.
   */
  readonly type: 'loose_tuple';
  /**
   * Authored constructor identity; no runtime package discovery occurs.
   */
  readonly reference: typeof looseTuple | typeof looseTupleAsync;
  /**
   * Private root-type diagnostic, not an authorization or escaping policy.
   */
  readonly expects: 'Array';
  /**
   * Borrowed ordered child schemas; no deep isolation is introduced.
   */
  readonly items: TItems;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Validate the declared positional prefix and retain trailing values without validating them. Construction captures trusted child references without parsing input.
 * @param {TItems} items - Borrowed trusted ordered child schemas; this API does not clone or freeze the tuple.
 * @returns {LooseTupleSchemaAsync<TItems, undefined>} Inert asynchronous schema sharing root execution limits and cancellation when explicitly parsed.
 */
export function looseTupleAsync<const TItems extends TupleItemsAsync>(
  items: TItems
): LooseTupleSchemaAsync<TItems, undefined>;

/** Validate the declared positional prefix and retain trailing values without validating them. Construction captures trusted child references without parsing input.
 * @param {TItems} items - Borrowed trusted ordered child schemas; this API does not clone or freeze the tuple.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback, not sanitized client feedback.
 * @returns {LooseTupleSchemaAsync<TItems, TMessage>} Inert asynchronous schema sharing root execution limits and cancellation when explicitly parsed.
 */
export function looseTupleAsync<
  const TItems extends TupleItemsAsync,
  const TMessage extends ErrorMessage<LooseTupleIssue> | undefined,
>(items: TItems, message: TMessage): LooseTupleSchemaAsync<TItems, TMessage>;

/** Validate the declared positional prefix and retain trailing values without validating them. Construction captures trusted child references without parsing input.
 * @param {TupleItemsAsync} items - Borrowed trusted ordered child schemas; this API does not clone or freeze the tuple.
 * @param {ErrorMessage<LooseTupleIssue>} message - Optional trusted private diagnostic text/callback, not sanitized client feedback.
 * @returns {LooseTupleSchemaAsync<TupleItemsAsync, ErrorMessage<LooseTupleIssue> | undefined>} Inert asynchronous schema sharing root execution limits and cancellation when explicitly parsed.
 */
// @__NO_SIDE_EFFECTS__
export function looseTupleAsync(
  items: TupleItemsAsync,
  message?: ErrorMessage<LooseTupleIssue>
): LooseTupleSchemaAsync<
  TupleItemsAsync,
  ErrorMessage<LooseTupleIssue> | undefined
> {
  return {
    kind: 'schema',
    type: 'loose_tuple',
    reference: looseTupleAsync,
    expects: 'Array',
    async: true,
    items,
    message,
    /** Adapt explicit validation to the bounded shared root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Validate the declared positional prefix and retain trailing values without validating them. Child parsing starts concurrently; abortEarly affects result accumulation after that work starts.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private candidate structural input; raw child issues retain its original values/paths.
     * @param {import('../types/index.js').Config<import('../types/index.js').BaseIssue<unknown>>} config - Shared root budgets, cancellation and private diagnostic policy.
     * @returns {Promise<OutputDataset<unknown, import('../types/index.js').BaseIssue<unknown>>>} Declared structural output or private issues; root execution drains owned started callbacks on operational failure.
     */
    async '~run'(dataset, config) {
      // Get input value from dataset
      /** Borrowed structural input retained for own-field reads and private issue paths. */
      const input = dataset.value;

      // If root type is valid, check nested types
      if (Array.isArray(input)) {
        // Set typed to `true` and value to empty array
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
        dataset.value = [];

        // Parse schema of each tuple item
        /** Concurrent declared-position results retained in tuple order for issue accumulation. */
        const itemDatasets = await Promise.all(
          this.items.map(async (item, key) => {
            /** Original field/position value, or undefined for a missing optional/defaulted input. */
            const value = input[key];
            return [
              key,
              value,
              await _runSchema(item, { value }, config),
            ] as const;
          })
        );

        // Process each tuple item dataset
        for (const [key, value, itemDataset] of itemDatasets) {
          // If there are issues, capture them
          if (itemDataset.issues) {
            // Create tuple path item
            /** Private parent path segment retaining original input/value; public feedback must sanitize it. */
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
