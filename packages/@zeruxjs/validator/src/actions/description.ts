import type { BaseMetadata } from '../types/index.js';

/**
 * Description action interface.
 */
export interface DescriptionAction<
  TInput,
  TDescription extends string,
> extends BaseMetadata<TInput> {
  /**
   * The action type.
   */
  readonly type: 'description';
  /**
   * The action reference.
   */
  readonly reference: typeof description;
  /**
   * The description text.
   */
  readonly description: TDescription;
}

/**
 * Creates a description metadata action.
 *
 * @param {TDescription} description_ - Borrowed host-owned text; renderers must escape it for their output context.
 *
 * @returns {DescriptionAction<TInput, TDescription>} Structured metadata descriptor with no validation runner or cleanup resource.
 */
// @__NO_SIDE_EFFECTS__
export function description<TInput, TDescription extends string>(
  description_: TDescription
): DescriptionAction<TInput, TDescription> {
  return {
    kind: 'metadata',
    type: 'description',
    reference: description,
    description: description_,
  };
}
