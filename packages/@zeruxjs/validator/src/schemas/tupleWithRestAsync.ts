import { _runSchema } from '../utils/_run.js';
import type {
  ArrayPathItem,
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  ErrorMessage,
  InferInput,
  InferIssue,
  InferOutput,
  InferTupleInput,
  InferTupleIssue,
  InferTupleOutput,
  OutputDataset,
  TupleItemsAsync,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';
import type { tupleWithRest } from './tupleWithRest.js';
import type { TupleWithRestIssue } from './types/tupleWithRest.js';

/**
 * Tuple with rest schema async interface.
 */
export interface TupleWithRestSchemaAsync<
  TItems extends TupleItemsAsync,
  TRest extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  TMessage extends ErrorMessage<TupleWithRestIssue> | undefined,
> extends BaseSchemaAsync<
  [...InferTupleInput<TItems>, ...InferInput<TRest>[]],
  [...InferTupleOutput<TItems>, ...InferOutput<TRest>[]],
  TupleWithRestIssue | InferTupleIssue<TItems> | InferIssue<TRest>
> {
  /**
   * Stable structural discriminator for issue and metadata consumers.
   */
  readonly type: 'tuple_with_rest';
  /**
   * Authored constructor identity; no runtime package discovery occurs.
   */
  readonly reference: typeof tupleWithRest | typeof tupleWithRestAsync;
  /**
   * Private root-type diagnostic, not an authorization or escaping policy.
   */
  readonly expects: 'Array';
  /**
   * Borrowed ordered child schemas; no deep isolation is introduced.
   */
  readonly items: TItems;
  /**
   * Borrowed explicit schema for extra values; no implicit dynamic handler resolution.
   */
  readonly rest: TRest;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Validate the declared positional prefix and validate trailing values with the explicit rest schema. Construction captures trusted child references without parsing input.
 * @param {TItems} items - Borrowed trusted ordered child schemas; this API does not clone or freeze the tuple.
 * @param {TRest} rest - Borrowed explicit schema used only for safe extra fields or trailing values; never resolved from input.
 * @returns {TupleWithRestSchemaAsync<TItems, TRest, undefined>} Inert asynchronous schema sharing root execution limits and cancellation when explicitly parsed.
 */
export function tupleWithRestAsync<
  const TItems extends TupleItemsAsync,
  const TRest extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
>(
  items: TItems,
  rest: TRest
): TupleWithRestSchemaAsync<TItems, TRest, undefined>;

/** Validate the declared positional prefix and validate trailing values with the explicit rest schema. Construction captures trusted child references without parsing input.
 * @param {TItems} items - Borrowed trusted ordered child schemas; this API does not clone or freeze the tuple.
 * @param {TRest} rest - Borrowed explicit schema used only for safe extra fields or trailing values; never resolved from input.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback, not sanitized client feedback.
 * @returns {TupleWithRestSchemaAsync<TItems, TRest, TMessage>} Inert asynchronous schema sharing root execution limits and cancellation when explicitly parsed.
 */
export function tupleWithRestAsync<
  const TItems extends TupleItemsAsync,
  const TRest extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  const TMessage extends ErrorMessage<TupleWithRestIssue> | undefined,
>(
  items: TItems,
  rest: TRest,
  message: TMessage
): TupleWithRestSchemaAsync<TItems, TRest, TMessage>;

/** Validate the declared positional prefix and validate trailing values with the explicit rest schema. Construction captures trusted child references without parsing input.
 * @param {TupleItemsAsync} items - Borrowed trusted ordered child schemas; this API does not clone or freeze the tuple.
 * @param {BaseSchema<unknown, unknown, BaseIssue<unknown>> | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>} rest - Borrowed explicit schema used only for safe extra fields or trailing values; never resolved from input.
 * @param {ErrorMessage<TupleWithRestIssue>} message - Optional trusted private diagnostic text/callback, not sanitized client feedback.
 * @returns {TupleWithRestSchemaAsync<TupleItemsAsync, BaseSchema<unknown, unknown, BaseIssue<unknown>> | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>, ErrorMessage<TupleWithRestIssue> | undefined>} Inert asynchronous schema sharing root execution limits and cancellation when explicitly parsed.
 */
// @__NO_SIDE_EFFECTS__
export function tupleWithRestAsync(
  items: TupleItemsAsync,
  rest:
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  message?: ErrorMessage<TupleWithRestIssue>
): TupleWithRestSchemaAsync<
  TupleItemsAsync,
  | BaseSchema<unknown, unknown, BaseIssue<unknown>>
  | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  ErrorMessage<TupleWithRestIssue> | undefined
> {
  return {
    kind: 'schema',
    type: 'tuple_with_rest',
    reference: tupleWithRestAsync,
    expects: 'Array',
    async: true,
    items,
    rest,
    message,
    /** Adapt explicit validation to the bounded shared root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Validate the declared positional prefix and validate trailing values with the explicit rest schema. Child parsing starts concurrently; abortEarly affects result accumulation after that work starts.
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

        // Parse each normal and rest item
        /** Declared and extra child result groups started together; accumulation keeps normal values before rest values. */
        const [normalDatasets, restDatasets] = await Promise.all([
          // Parse schema of each normal item
          Promise.all(
            this.items.map(async (item, key) => {
              /** Original field/position value, or undefined for a missing optional/defaulted input. */
              const value = input[key];
              return [
                key,
                value,
                await _runSchema(item, { value }, config),
              ] as const;
            })
          ),

          // Parse other items with rest schema
          Promise.all(
            input.slice(this.items.length).map(async (value, key) => {
              return [
                key + this.items.length,
                value,
                await _runSchema(this.rest, { value }, config),
              ] as const;
            })
          ),
        ]);

        // Process each tuple item dataset
        for (const [key, value, itemDataset] of normalDatasets) {
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

        // Parse rest with schema if necessary
        if (!dataset.issues || !config.abortEarly) {
          for (const [key, value, itemDataset] of restDatasets) {
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
