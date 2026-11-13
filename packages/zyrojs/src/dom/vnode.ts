/** Minimal, browser-native VNode representation. JSX is not required. */
export type VNodeChild =
  | VNode
  | string
  | number
  | boolean
  | null
  | undefined
  | (() => VNodeChild)
  | VNodeChild[];
export interface VNode {
  /** Element tag name or component function used to construct the node. */
  type: string | ((props: any) => VNodeChild);
  /** Public props applied to the element or component. */
  props: Record<string, any>;
  /** Child values normalized by the renderer. */
  children: VNodeChild[];
  /** Set only while mounted. Do not reuse a VNode object in multiple roots. */
  el?: Node;
}
/**
 * h.
 * @param {(props: P) => VNodeChild} type - Input value for this operation.
 * @param {P | null} props - Input value for this operation.
 * @param {VNodeChild[]} children - Input value for this operation.
 * @returns {VNode} Result produced by this operation.
 */
export function h<P extends Record<string, any>>(
  type: (props: P) => VNodeChild,
  props: P | null,
  ...children: VNodeChild[]
): VNode;
/**
 * h.
 * @param {string} type - Input value for this operation.
 * @param {Record<string, any> | null} props - Input value for this operation.
 * @param {VNodeChild[]} children - Input value for this operation.
 * @returns {VNode} Result produced by this operation.
 */
export function h(
  type: string,
  props: Record<string, any> | null,
  ...children: VNodeChild[]
): VNode;
/**
 * h.
 * @param {VNode['type']} type - Input value for this operation.
 * @param {Record<string, any> | null} props - Input value for this operation.
 * @param {VNodeChild[]} children - Input value for this operation.
 * @returns {VNode} Result produced by this operation.
 */
export function h(
  type: VNode['type'],
  props: Record<string, any> | null,
  ...children: VNodeChild[]
): VNode {
  return {
    type,
    props: props ?? {},
    children: children.filter(
      (child) => child !== null && child !== undefined && child !== false
    ),
  };
}
