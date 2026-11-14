/** Historical bundled virtual node. This is an app-local compatibility contract, not current ZyroJS API. */
export interface LegacyNode {
  /** Authored tag or mount-time component callback. */
  type: string | (() => LegacyNode);
  /** Native property values assigned by the historical renderer. */
  props: Record<string, unknown>;
  /** Static/scalar/reactive children retained by the historical runtime. */
  children: unknown[];
}
/** Describe one node without executing components.
 * @param {LegacyNode["type"]} type - Fixed tag or trusted authored component.
 * @param {Record<string, unknown> | null} props - Native DOM properties.
 * @param {unknown[]} children - Child descriptions, scalar values or reactive getters.
 * @returns {LegacyNode} Historical virtual-node description.
 */
export function h(
  type: LegacyNode['type'],
  props: Record<string, unknown> | null,
  ...children: unknown[]
): LegacyNode;
/** Render into an existing owned mount.
 * @param {LegacyNode} vnode - Trusted authored node description.
 * @param {HTMLElement} container - Existing host element.
 * @returns {void} Updates the historical tree; no unmount handle exists.
 */
export function render(vnode: LegacyNode, container: HTMLElement): void;
/** Allocate mount-local state.
 * @template T
 * @param {T} initialValue - Initial scalar state.
 * @returns {[() => T, (value: T) => void]} Getter and direct-value setter.
 */
export function useState<T>(initialValue: T): [() => T, (value: T) => void];
/** Register a page-lifetime effect in the historical runtime.
 * @param {() => void} fn - Trusted synchronous callback.
 * @returns {void} No disposer is exposed by this historical helper.
 */
export function useEffect(fn: () => void): void;
