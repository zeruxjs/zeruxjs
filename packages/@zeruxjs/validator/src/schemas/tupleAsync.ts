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
import type { tuple } from './tuple.js';
import type { TupleIssue } from './types/tuple.js';

/**
 * Tuple schema async interface.
 */
export interface TupleSchemaAsync<
  TItems extends TupleItemsAsync,
  TMessage extends ErrorMessage<TupleIssue> | undefined,
> extends BaseSchemaAsync<
  InferTupleInput<TItems>,
  InferTupleOutput<TItems>,
  TupleIssue | InferTupleIssue<TItems>
> {
  /**
   * Stable structural discriminator for issue and metadata consumers.
   */
  readonly type: 'tuple';
  /**
   * Authored constructor identity; no runtime package discovery occurs.
   */
  readonly reference: typeof tuple | typeof tupleAsync;
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

/** Parse the declared positional prefix and omit trailing items; missing positions are delegated as undefined. Construction captures trusted child references without parsing input.
 * @param {TItems} items - Borrowed trusted ordered child schemas; this API does not clone or freeze the tuple.
 * @returns {TupleSchemaAsync<TItems, undefined>} Inert asynchronous schema sharing root execution limits and cancellation when explicitly parsed.
 */
export function tupleAsync<const TItems extends TupleItemsAsync>(
  items: TItems
): TupleSchemaAsync<TItems, undefined>;

/** Parse the declared positional prefix and omit trailing items; missing positions are delegated as undefined. Construction captures trusted child references without parsing input.
 * @param {TItems} items - Borrowed trusted ordered child schemas; this API does not clone or freeze the tuple.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback, not sanitized client feedback.
 * @returns {TupleSchemaAsync<TItems, TMessage>} Inert asynchronous schema sharing root execution limits and cancellation when explicitly parsed.
 */
export function tupleAsync<
  const TItems extends TupleItemsAsync,
  const TMessage extends ErrorMessage<TupleIssue> | undefined,
>(items: TItems, message: TMessage): TupleSchemaAsync<TItems, TMessage>;

/** Parse the declared positional prefix and omit trailing items; missing positions are delegated as undefined. Construction captures trusted child references without parsing input.
 * @param {TupleItemsAsync} items - Borrowed trusted ordered child schemas; this API does not clone or freeze the tuple.
 * @param {ErrorMessage<TupleIssue>} message - Optional trusted private diagnostic text/callback, not sanitized client feedback.
 * @returns {TupleSchemaAsync<TupleItemsAsync, ErrorMessage<TupleIssue> | undefined>} Inert asynchronous schema sharing root execution limits and cancellation when explicitly parsed.
 */
// @__NO_SIDE_EFFECTS__
export function tupleAsync(
  items: TupleItemsAsync,
  message?: ErrorMessage<TupleIssue>
): TupleSchemaAsync<TupleItemsAsync, ErrorMessage<TupleIssue> | undefined> {
  return {
    kind: 'schema',
    type: 'tuple',
    reference: tupleAsync,
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
    /** Parse the declared positional prefix and omit trailing items; missing positions are delegated as undefined. Child parsing starts concurrently; abortEarly affects result accumulation after that work starts.
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

        // Otherwise, add tuple issue
      } else {
        _addIssue(this, 'type', dataset, config);
      }

      // Return output dataset
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<
        unknown[],
        TupleIssue | BaseIssue<unknown>
      >;
    },
  };
}
