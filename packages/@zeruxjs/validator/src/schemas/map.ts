import { _runSchema } from '../utils/_run.js';
import type {
  BaseIssue,
  BaseSchema,
  ErrorMessage,
  InferIssue,
  MapPathItem,
  OutputDataset,
} from '../types/index.js';
import { _addIssue, _getStandardProps } from '../utils/index.js';
import type { InferMapInput, InferMapOutput, MapIssue } from './types/map.js';

/**
 * Map schema interface.
 */
export interface MapSchema<
  TKey extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TValue extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  TMessage extends ErrorMessage<MapIssue> | undefined,
> extends BaseSchema<
  InferMapInput<TKey, TValue>,
  InferMapOutput<TKey, TValue>,
  MapIssue | InferIssue<TKey> | InferIssue<TValue>
> {
  /**
   * Stable schema discriminator used by structured issue consumers.
   */
  readonly type: 'map';
  /**
   * Authored constructor identity; no runtime package discovery occurs.
   */
  readonly reference: typeof map;
  /**
   * Private native-type diagnostic, not a permission or coercion policy.
   */
  readonly expects: 'Map';
  /**
   * Borrowed explicit Map key schema; no automatic key serialization or tenant scoping.
   */
  readonly key: TKey;
  /**
   * Borrowed explicit Map value schema; no deep copying is guaranteed.
   */
  readonly value: TValue;
  /**
   * Optional trusted private diagnostic text/callback.
   */
  readonly message: TMessage;
}

/** Validate native Map keys before values in insertion order; transformed duplicate keys retain the last assigned value. Construction does not parse input or authorize its source.
 * @param {TKey} key - Borrowed explicit Map key schema; transformations can merge keys under native Map equality.
 * @param {TValue} value - Borrowed explicit value schema; accepted nested objects may retain caller-owned identity.
 * @returns {MapSchema<TKey, TValue, undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function map<
  const TKey extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TValue extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
>(key: TKey, value: TValue): MapSchema<TKey, TValue, undefined>;

/** Validate native Map keys before values in insertion order; transformed duplicate keys retain the last assigned value. Construction does not parse input or authorize its source.
 * @param {TKey} key - Borrowed explicit Map key schema; transformations can merge keys under native Map equality.
 * @param {TValue} value - Borrowed explicit value schema; accepted nested objects may retain caller-owned identity.
 * @param {TMessage} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {MapSchema<TKey, TValue, TMessage>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
export function map<
  const TKey extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TValue extends BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  const TMessage extends ErrorMessage<MapIssue> | undefined,
>(
  key: TKey,
  value: TValue,
  message: TMessage
): MapSchema<TKey, TValue, TMessage>;

/** Validate native Map keys before values in insertion order; transformed duplicate keys retain the last assigned value. Construction does not parse input or authorize its source.
 * @param {BaseSchema<unknown, unknown, BaseIssue<unknown>>} key - Borrowed explicit Map key schema; transformations can merge keys under native Map equality.
 * @param {BaseSchema<unknown, unknown, BaseIssue<unknown>>} value - Borrowed explicit value schema; accepted nested objects may retain caller-owned identity.
 * @param {ErrorMessage<MapIssue>} message - Optional trusted private diagnostic text/callback; raw errors may retain input.
 * @returns {MapSchema<BaseSchema<unknown, unknown, BaseIssue<unknown>>, BaseSchema<unknown, unknown, BaseIssue<unknown>>, ErrorMessage<MapIssue> | undefined>} Inert schema retaining its declared references and message policy; no external resource owner is allocated.
 */
// @__NO_SIDE_EFFECTS__
export function map(
  key: BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  value: BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  message?: ErrorMessage<MapIssue>
): MapSchema<
  BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  BaseSchema<unknown, unknown, BaseIssue<unknown>>,
  ErrorMessage<MapIssue> | undefined
> {
  return {
    kind: 'schema',
    type: 'map',
    reference: map,
    expects: 'Map',
    async: false,
    key,
    value,
    message,
    /** Adapt explicit validation to the bounded shared root execution path.
     * @returns {object} Inert Standard Schema V1 adapter.
     */
    get '~standard'() {
      return _getStandardProps(this);
    },
    /** Validate native Map keys before values in insertion order; transformed duplicate keys retain the last assigned value. Raw issues remain private and operational failures propagate.
     * @param {import('../types/index.js').UnknownDataset} dataset - Private current candidate; this schema does not grant permissions or sanitize output.
     * @param {import('../types/index.js').Config<BaseIssue<unknown>>} config - Shared root budgets, cancellation, abort flags and diagnostic policy.
     * @returns {OutputDataset<unknown, BaseIssue<unknown>>} Declared output or private issue dataset; child result identity follows its schema.
     */
    '~run'(dataset, config) {
      // Get input value from dataset
      /** Borrowed candidate retained for child reads and private issue paths. */
      const input = dataset.value;

      // If root type is valid, check nested types
      if (input instanceof Map) {
        // Set typed to `true` and value to empty map
        // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
        dataset.typed = true;
        dataset.value = new Map();

        // Parse schema of each map entry
        for (const [inputKey, inputValue] of input) {
          // Get dataset of key schema
          /** Current Map key result; transformed keys, not source keys, determine output identity. */
          const keyDataset = _runSchema(this.key, { value: inputKey }, config);

          // If there are issues, capture them
          if (keyDataset.issues) {
            // Create map path item
            /** Private parent path segment retaining original input/value; sanitize before client exposure. */
            const pathItem: MapPathItem = {
              type: 'map',
              origin: 'key',
              input,
              key: inputKey,
              value: inputValue,
            };

            // Add modified item dataset issues to issues
            for (const issue of keyDataset.issues) {
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
              dataset.issues = keyDataset.issues;
            }

            // If necessary, abort early
            if (config.abortEarly) {
              dataset.typed = false;
              break;
            }
          }

          // Get dataset of value schema
          /** Current child value result sharing the root execution policy; raw issues remain private. */
          const valueDataset = _runSchema(
            this.value,
            { value: inputValue },
            config
          );

          // If there are issues, capture them
          if (valueDataset.issues) {
            // Create map path item
            /** Private parent path segment retaining original input/value; sanitize before client exposure. */
            const pathItem: MapPathItem = {
              type: 'map',
              origin: 'value',
              input,
              key: inputKey,
              value: inputValue,
            };

            // Add modified item dataset issues to issues
            for (const issue of valueDataset.issues) {
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
              dataset.issues = valueDataset.issues;
            }

            // If necessary, abort early
            if (config.abortEarly) {
              dataset.typed = false;
              break;
            }
          }

          // If not typed, map typed to `false`
          if (!keyDataset.typed || !valueDataset.typed) {
            dataset.typed = false;
          }

          // Add value to dataset
          // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
          dataset.value.set(keyDataset.value, valueDataset.value);
        }

        // Otherwise, add map issue
      } else {
        _addIssue(this, 'type', dataset, config);
      }

      // Return output dataset
      // @ts-expect-error -- Runtime validation narrows this generic branch beyond static inference.
      return dataset as OutputDataset<
        Map<unknown, unknown>,
        MapIssue | BaseIssue<unknown>
      >;
    },
  };
}
