import type { VNodeChild } from './vnode.js';

export type Component<P = Record<string, unknown>> = (props: P) => VNodeChild;
export interface ComponentOptions {
  /** Handles synchronous setup/render failures only; event and Promise errors stay with their caller. */
  onError?: (error: unknown) => VNodeChild;
}
/** Private weak registry links opaque component functions to trusted setup code without extending their lifetime. */
const definitions = new WeakMap<
  object,
  { setup: (...args: any[]) => any; onError?: ComponentOptions['onError'] }
>();
let rendering = 0;
/** Signal convenience hooks allocate resources and must run in setup, never in a repeated render. */
/**
 * Reject resource allocation during repeated render; one-time setup owns hooks.
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
 * Mark a synchronous render so allocating hooks cannot leak repeated resources.
 * @param {() => T} fn - Trusted synchronous render callback; the guard is restored even if it throws.
 * @returns {T} Rendered value; no asynchronous render context is retained.
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
 * Look up explicitly registered setup metadata by exact component identity.
 * @param {object} component - Authored function identity; arbitrary objects are never evaluated.
 * @returns {{ setup: (...args: any[]) => any; onError?: ComponentOptions["onError"] } | undefined} Registered setup and optional boundary, or undefined for an ordinary component.
 */
export function getComponentDefinition(component: object) {
  return definitions.get(component);
}
/** Setup runs once per mounted type/key. Returned render receives current props on every update. */
/**
 * Register one-time setup; the renderer retains its returned render function per mounted type/key.
 * @param {(initialProps: P) => Component<P>} setup - Trusted synchronous initializer receiving initial props; returns a render reading current props.
 * @param {ComponentOptions} options - Optional synchronous setup/render error boundary; event and promise errors stay with their caller.
 * @returns {Component<P>} Opaque component identity for h/render; direct invocation throws.
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
   * Reject direct calls that would bypass renderer-owned setup and teardown.
   * @returns {never} Always throws; only the renderer may instantiate setup components.
   */
  const component: Component<P> = () => {
    throw new Error(
      'ZyroJS: setup components must be rendered through the DOM renderer'
    );
  };
  definitions.set(component, { setup, onError: options.onError });
  return component;
}
