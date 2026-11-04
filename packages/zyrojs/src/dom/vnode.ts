/** Minimal, browser-native VNode representation. JSX is not required. */
export type VNodeChild = VNode | string | number | boolean | null | undefined | (() => VNodeChild) | VNodeChild[];
export interface VNode {
  type: string | ((props: any) => VNodeChild);
  props: Record<string, any>;
  children: VNodeChild[];
  /** Set only while mounted. Do not reuse a VNode object in multiple roots. */
  el?: Node;
}
export function h<P extends Record<string, any>>(type: (props: P) => VNodeChild, props: P | null, ...children: VNodeChild[]): VNode;
export function h(type: string, props: Record<string, any> | null, ...children: VNodeChild[]): VNode;
export function h(type: VNode['type'], props: Record<string, any> | null, ...children: VNodeChild[]): VNode {
  return { type, props: props ?? {}, children: children.filter(child => child !== null && child !== undefined && child !== false) };
}
