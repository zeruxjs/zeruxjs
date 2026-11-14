import type { BaseMetadata } from '../types/index.js';

/**
 * Title action interface.
 */
export interface TitleAction<
  TInput,
  TTitle extends string,
> extends BaseMetadata<TInput> {
  /**
   * The action type.
   */
  readonly type: 'title';
  /**
   * The action reference.
   */
  readonly reference: typeof title;
  /**
   * The title text.
   */
  readonly title: TTitle;
}

/**
 * Creates a title metadata action.
 *
 * @param {TTitle} title_ - Borrowed host-owned text; renderers must escape it for their output context.
 *
 * @returns {TitleAction<TInput, TTitle>} Structured metadata descriptor with no validation runner or cleanup resource.
 */
// @__NO_SIDE_EFFECTS__
export function title<TInput, TTitle extends string>(
  title_: TTitle
): TitleAction<TInput, TTitle> {
  return {
    kind: 'metadata',
    type: 'title',
    reference: title,
    title: title_,
  };
}
