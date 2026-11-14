import type { BaseMetadata } from '../types/index.js';

/**
 * Metadata action interface.
 */
export interface MetadataAction<
  TInput,
  TMetadata extends Record<string, unknown>,
> extends BaseMetadata<TInput> {
  /**
   * The action type.
   */
  readonly type: 'metadata';
  /**
   * The action reference.
   */
  readonly reference: typeof metadata;
  /**
   * The metadata object.
   */
  readonly metadata: TMetadata;
}

/**
 * Creates a custom metadata action.
 *
 * @param {TMetadata} metadata_ - Borrowed host-owned metadata record; no cloning, validation, serialization or source evaluation is performed.
 *
 * @returns {MetadataAction<TInput, TMetadata>} Descriptor retaining the borrowed record; it is not a sanitizer or an authorization policy.
 */
// @__NO_SIDE_EFFECTS__
export function metadata<
  TInput,
  const TMetadata extends Record<string, unknown>,
>(metadata_: TMetadata): MetadataAction<TInput, TMetadata> {
  return {
    kind: 'metadata',
    type: 'metadata',
    reference: metadata,
    metadata: metadata_,
  };
}
