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
 * Describe an inert node for later rendering; this constructor does not mount or execute components.
 * @param {(props: P) => VNodeChild} type - Trusted authored element tag or component; never select executable callbacks from untrusted data.
 * @param {P | null} props - Borrowed props object; null creates an empty record and no deep clone is performed.
 * @param {VNodeChild[]} children - Child descriptions; null, undefined and false are omitted at construction.
 * @returns {VNode} Fresh mutable node description; do not reuse it across mounted roots.
 */
export function h<P extends Record<string, any>>(
  type: (props: P) => VNodeChild,
  props: P | null,
  ...children: VNodeChild[]
): VNode;
/**
 * Describe an inert node for later rendering; this constructor does not mount or execute components.
 * @param {string} type - Trusted authored element tag or component; never select executable callbacks from untrusted data.
 * @param {Record<string, any> | null} props - Borrowed props object; null creates an empty record and no deep clone is performed.
 * @param {VNodeChild[]} children - Child descriptions; null, undefined and false are omitted at construction.
 * @returns {VNode} Fresh mutable node description; do not reuse it across mounted roots.
 */
export function h(
  type: string,
  props: Record<string, any> | null,
  ...children: VNodeChild[]
): VNode;
/**
 * Describe an inert node for later rendering; this constructor does not mount or execute components.
 * @param {VNode['type']} type - Trusted authored element tag or component; never select executable callbacks from untrusted data.
 * @param {Record<string, any> | null} props - Borrowed props object; null creates an empty record and no deep clone is performed.
 * @param {VNodeChild[]} children - Child descriptions; null, undefined and false are omitted at construction.
 * @returns {VNode} Fresh mutable node description; do not reuse it across mounted roots.
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
