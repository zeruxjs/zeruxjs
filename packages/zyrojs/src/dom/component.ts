import type { VNodeChild } from './vnode.js';

export type Component<P = Record<string, unknown>> = (props: P) => VNodeChild;
export interface ComponentOptions {
  /** Handles synchronous setup/render failures only; event and Promise errors stay with their caller. */
  onError?: (error: unknown) => VNodeChild;
}
const definitions = new WeakMap<Function, { setup: Function; onError?: ComponentOptions['onError'] }>();
let rendering = 0;
/** Signal convenience hooks allocate resources and must run in setup, never in a repeated render. */
export function assertSetupHook(): void {
  if (rendering) throw new Error('ZyroJS: state/effect hooks cannot run during render; use defineComponent setup');
}
export function runComponentRender<T>(fn: () => T): T {
  rendering++;
  try { return fn(); } finally { rendering--; }
}
export function getComponentDefinition(component: Function) { return definitions.get(component); }
/** Setup runs once per mounted type/key. Returned render receives current props on every update. */
export function defineComponent<P extends Record<string, any> = Record<string, unknown>>(
  setup: (initialProps: P) => Component<P>, options: ComponentOptions = {}
): Component<P> {
  if (typeof setup !== 'function' || (options.onError !== undefined && typeof options.onError !== 'function')) {
    throw new TypeError('ZyroJS: invalid component definition');
  }
  const component: Component<P> = () => { throw new Error('ZyroJS: setup components must be rendered through the DOM renderer'); };
  definitions.set(component, { setup, onError: options.onError });
  return component;
}
