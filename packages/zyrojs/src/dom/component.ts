import type { VNodeChild } from './vnode.js';

export type Component<P = Record<string, unknown>> = (props: P) => VNodeChild;
export interface ComponentOptions {
  /** Handles synchronous setup/render failures only; event and Promise errors stay with their caller. */
  onError?: (error: unknown) => VNodeChild;
}
/** Stores the definitions value used by this module. */
const definitions = new WeakMap<
  object,
  { setup: (...args: any[]) => any; onError?: ComponentOptions['onError'] }
>();
let rendering = 0;
/** Signal convenience hooks allocate resources and must run in setup, never in a repeated render. */
/**
 * assertSetupHook.
 * @returns {void} Result produced by this operation.
 */
export function assertSetupHook(): void {
  if (rendering) {
    throw new Error(
      'ZyroJS: state/effect hooks cannot run during render; use defineComponent setup'
    );
  }
}
/**
 * runComponentRender.
 * @param {() => T} fn - Input value for this operation.
 * @returns {T} Result produced by this operation.
 */
export function runComponentRender<T>(fn: () => T): T {
  rendering++;
  try {
    return fn();
  } finally {
    rendering--;
  }
}
/**
 * getComponentDefinition.
 * @param {object} component - Input value for this operation.
 * @returns {unknown} Result produced by this operation.
 */
export function getComponentDefinition(component: object) {
  return definitions.get(component);
}
/** Setup runs once per mounted type/key. Returned render receives current props on every update. */
/**
 * defineComponent.
 * @param {(initialProps: P) => Component<P>} setup - Input value for this operation.
 * @param {ComponentOptions} options - Input value for this operation.
 * @returns {Component<P>} Result produced by this operation.
 */
export function defineComponent<
  P extends Record<string, any> = Record<string, unknown>,
>(
  setup: (initialProps: P) => Component<P>,
  options: ComponentOptions = {}
): Component<P> {
  if (
    typeof setup !== 'function' ||
    (options.onError !== undefined && typeof options.onError !== 'function')
  ) {
    throw new TypeError('ZyroJS: invalid component definition');
  }
  /**
   * Application function component.
   * @returns {unknown} Result produced by this operation.
   */
  const component: Component<P> = () => {
    throw new Error(
      'ZyroJS: setup components must be rendered through the DOM renderer'
    );
  };
  definitions.set(component, { setup, onError: options.onError });
  return component;
}
