import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  InferInput,
  InferOutput,
} from '../../types/index.js';

/**
 * Map issue interface.
 */
export interface MapIssue extends BaseIssue<unknown> {
  /**
   * Fixed native-collection schema category; rejected input remains private.
   */
  readonly kind: 'schema';
  /**
   * Stable collection discriminator for structured issue consumers.
   */
  readonly type: 'map';
  /**
   * Private native-type diagnostic; no input conversion or authorization is implied.
   */
  readonly expected: 'Map';
}

/**
 * Infer accepted native collection keys/values from the declared child input types.
 */
export type InferMapInput<
  TKey extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  TValue extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> = Map<InferInput<TKey>, InferInput<TValue>>;

/**
 * Infer native collection output after child transforms; runtime key/value collisions still use native equality.
 */
export type InferMapOutput<
  TKey extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
  TValue extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> = Map<InferOutput<TKey>, InferOutput<TValue>>;
