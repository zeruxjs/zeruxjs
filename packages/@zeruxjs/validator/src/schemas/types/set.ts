import type {
  BaseIssue,
  BaseSchema,
  BaseSchemaAsync,
  InferInput,
  InferOutput,
} from '../../types/index.js';

/**
 * Set issue interface.
 */
export interface SetIssue extends BaseIssue<unknown> {
  /**
   * Fixed native-collection schema category; rejected input remains private.
   */
  readonly kind: 'schema';
  /**
   * Stable collection discriminator for structured issue consumers.
   */
  readonly type: 'set';
  /**
   * Private native-type diagnostic; no input conversion or authorization is implied.
   */
  readonly expected: 'Set';
}

/**
 * Infer accepted native collection keys/values from the declared child input types.
 */
export type InferSetInput<
  TValue extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> = Set<InferInput<TValue>>;

/**
 * Infer native collection output after child transforms; runtime key/value collisions still use native equality.
 */
export type InferSetOutput<
  TValue extends
    | BaseSchema<unknown, unknown, BaseIssue<unknown>>
    | BaseSchemaAsync<unknown, unknown, BaseIssue<unknown>>,
> = Set<InferOutput<TValue>>;
