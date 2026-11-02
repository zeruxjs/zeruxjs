/** Universal authored component helpers. This entry imports no DOM renderer or network client. */
export { h, type VNode, type VNodeChild } from './dom/vnode.js';
export { defineComponent, type Component, type ComponentOptions } from './dom/component.js';
export { useId } from './dom/hydration-protocol.js';
export * from './hook/index.js';
export * from './reactivity/index.js';
export { trustedHTML, type TrustedHTMLFragment } from './dom/trusted-html.js';
