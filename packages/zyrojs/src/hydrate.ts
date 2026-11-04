import { batch } from './reactivity/effect.js';
import { h } from './dom/vnode.js';
import type { Component } from './dom/component.js';
import { adoptHydrationRoot, replaceHydrationRoot, hydrationRootOwned, attachHydrationCleanup, unmount } from './dom/render.js';
import { checkAbort, hydrationLimits, readHydrationData, HydrationError, type HydrationLimits, type HydrationPolicy } from './dom/hydration-protocol.js';
import { HydrationMismatch, validateHydrationTree, type HydrationSession, type MismatchDiagnostic } from './dom/hydration-runtime.js';
export { HydrationError, HYDRATION_VERSION, readHydrationData } from './dom/hydration-protocol.js';
export type { MismatchDiagnostic } from './dom/hydration-runtime.js';
export interface HydrateOptions<P> extends HydrationPolicy<P>, HydrationLimits {
  /** textContent of a host-owned application/json script, never executable code. */
  data: string;
  mismatch?: 'throw' | 'replace';
  onMismatch?: (diagnostic: MismatchDiagnostic) => void;
}
export interface HydrationHandle { readonly status: 'hydrated' | 'replaced'; dispose(): void }
/** Whole-root V1 adoption. Mismatches reject by default; replacement must be explicitly authorized. */
export function hydrate<P extends Record<string, any>>(component: Component<P>, container: Element, options: HydrateOptions<P>): HydrationHandle {
  if (typeof component !== 'function' || !container || container.nodeType !== 1) throw new TypeError('ZyroJS: hydrate requires a component and element container');
  const {data, validateProps, signal, mismatch: recovery = 'throw', onMismatch, ...limitInput} = options;
  if (!['throw', 'replace'].includes(recovery) || (onMismatch !== undefined && typeof onMismatch !== 'function')) throw new TypeError('ZyroJS: invalid mismatch policy');
  const limits = hydrationLimits(limitInput);
  checkAbort(signal);
  if (hydrationRootOwned(container)) throw new HydrationError('ROOT_OWNED', 'ZyroJS: container already has a render owner');
  const payload = readHydrationData(data, {validateProps, signal}, limits.maxPropsBytes);
  validateHydrationTree(container, limits, signal);
  const session: HydrationSession = {prefix: payload.idPrefix, components: 0, nodes: 0, depth: 0, initializing: true, active: true, committed: false, limits, signal, bindings: [], cursors: new Map(), textMarkers: [], created: new Set()};
  const vnode = h(component, payload.props);
  let acquired = false, status: HydrationHandle['status'] = 'hydrated';
  try {
    try {
      const first = container.childNodes[0], last = container.childNodes[container.childNodes.length - 1];
      if (!first || !last || first.nodeType !== 8 || first.textContent !== `zyro-h1:${payload.idPrefix}` || last.nodeType !== 8 || last.textContent !== '/zyro-h1') {
        throw new HydrationMismatch(Object.freeze({code: 'HYDRATION_MISMATCH', node: 0, expected: 'versioned-root-markers', actual: 'other'}));
      }
      session.cursors.set(container, first.nextSibling);
      batch(() => { adoptHydrationRoot(vnode, container, session, first, last); acquired = true; for (const apply of session.bindings.splice(0)) apply(); });
    } catch (error) {
      if (acquired || !(error instanceof HydrationMismatch)) throw error;
      onMismatch?.(error.diagnostic);
      checkAbort(signal);
      if (recovery !== 'replace') throw error;
      // A failed attempt has disposed all application acquisitions. Replacement intentionally loses DOM edits.
      batch(() => { replaceHydrationRoot(vnode, container, session); acquired = true; });
      status = 'replaced';
    }
    checkAbort(signal);
    let release = () => {};
    const abort = () => release();
    signal?.addEventListener('abort', abort, {once: true});
    release = attachHydrationCleanup(container, () => { signal?.removeEventListener('abort', abort); session.cursors.clear(); session.textMarkers.length = 0; session.created.clear(); session.bindings.length = 0; });
    let disposed = false;
    return Object.freeze({status, dispose() { if (!disposed) { disposed = true; release(); } }});
  } catch (error) {
    if (acquired) {
      try { unmount(container); } catch (cleanup) { throw new AggregateError([error, cleanup], 'ZyroJS: hydration and cleanup failed'); }
    }
    throw error;
  }
}
