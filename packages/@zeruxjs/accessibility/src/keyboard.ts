import { attributeOwner } from './ownership.js';
import { isFocusAvailable } from './focus.js';
/** Bounded dynamic composite navigation; roles/activation remain component-owned. */
export interface RovingOptions {
  /** Navigation axis: horizontal, vertical or both (default). */
  orientation?: 'horizontal' | 'vertical' | 'both';
  /** Wrap at enabled-list boundaries unless false; defaults to true. */
  loop?: boolean;
  /** Reverse horizontal arrow movement for rtl; otherwise ltr behavior. */
  direction?: 'ltr' | 'rtl';
  /** Optional synchronous boolean predicate in addition to native availability checks. */
  isDisabled?: (node: HTMLElement) => boolean;
  /** Positive scan/list budget, default 10,000 and maximum 50,000; root-query semantics are documented per API. */
  maxElements?: number;
}
/** Create a disposable dynamic composite controller; native activation/roles stay authored.
 * @param {() => HTMLElement[]} elements - Synchronous supplier read after reconciliation; bounded before deduplication.
 * @param {RovingOptions} options - Caller-owned options; see documented fields for defaults, limits and ownership.
 * @returns {{refresh:()=>void,onKey:(event:KeyboardEvent)=>void,setIndex:(value:number)=>void,readonly index:number,attach:(container:HTMLElement)=>()=>void,destroy:()=>void}} Owned controller writing only zero/minus-one; call refresh after reconciliation.
 * @throws {TypeError} For invalid supplier/policy types; list contents are checked when refreshed.
 * @throws {RangeError} For a configured item budget outside 1 through 50,000.
 */
export function createRovingTabIndex(
  elements: () => HTMLElement[],
  options: RovingOptions = {}
) {
  options = { ...options };
  if (
    (options.loop !== undefined && typeof options.loop !== 'boolean') ||
    (options.isDisabled !== undefined &&
      typeof options.isDisabled !== 'function')
  ) {
    throw new TypeError('Invalid roving policy');
  }
  if (
    typeof elements !== 'function' ||
    (options.orientation !== undefined &&
      !['horizontal', 'vertical', 'both'].includes(options.orientation)) ||
    (options.direction !== undefined &&
      !['ltr', 'rtl'].includes(options.direction))
  ) {
    throw new TypeError('Invalid roving options');
  }
  /** Validated supplier-array bound before deduplication; at most 50,000 items. */
  const max = options.maxElements ?? 10000;
  if (!Number.isSafeInteger(max) || max < 1 || max > 50000) {
    throw new RangeError('Invalid roving list budget');
  }
  let current: HTMLElement | undefined,
    all: HTMLElement[] = [],
    disposed = false,
    hadFocus = false;
  /** Tabindex attribute leases preserving later host-authored changes. */
  const owned = attributeOwner();
  /** Legacy tabIndex property leases for mock/non-reflecting elements. */
  const fallback = new Map<
    HTMLElement,
    {
      /** Original/last observed host value restored only while helper ownership remains valid. */
      /** Original/last observed host value restored only while helper ownership remains valid. */
      before: number;
      /** Regions whose inert attribute is currently helper-owned. */
      /** Last helper-written scalar value; a different host value must survive release. */
      applied: number;
    }
  >();
  /** Per-item focus listener removers; removed nodes release their own bindings. */
  const bindings = new Map<HTMLElement, () => void>();
  /** Explicitly attached keydown containers owned by this controller. */
  const containers = new Set<HTMLElement>();
  /** Validated navigation axis, defaulting to both horizontal and vertical arrows. */
  const orientation = options.orientation ?? 'both';
  /** Reject operations requiring a live controller after destroy.
   * @returns {void} No value; throws after this controller/state has been destroyed.
   */
  const assertLive = () => {
    if (disposed) {
      throw new Error('Roving list destroyed');
    }
  };
  /** Read a bounded supplier array and deduplicate without assuming DOM reconciliation.
   * @returns {HTMLElement[]} Fresh deduplicated validated supplier items; exceeding the array budget rejects.
   */
  const list = () => {
    /** Supplier result checked before any listener/tabindex changes. */
    const value = elements();
    if (
      !Array.isArray(value) ||
      value.length > max ||
      value.some((node) => !node || typeof node.focus !== 'function')
    ) {
      throw new TypeError('Invalid or oversized roving list');
    }
    return [...new Set(value)];
  };
  /** Filter semantic/native disabled entries plus the synchronous host predicate.
   * @param {HTMLElement[]} values - Current candidate items; returns a fresh enabled subset without assuming activation semantics.
   * @returns {HTMLElement[]} Fresh available items after native and synchronous host disabled checks.
   */
  const enabled = (values: HTMLElement[]) =>
    values.filter((node) => {
      /** Host disabled result; nonboolean async-like values reject instead of guessing. */
      const disabled = options.isDisabled?.(node);
      if (disabled !== undefined && typeof disabled !== 'boolean') {
        throw new TypeError(
          'Roving disabled predicate must be synchronous boolean'
        );
      }
      return !disabled && isFocusAvailable(node);
    });
  /** Set only zero/minus-one tabindex while retaining attribute/property ownership.
   * @param {HTMLElement} node - One current supplier element; writes/listeners belong to this composite owner.
   * @param {number} value - Explicit input/attribute value; validation and effect are described by this helper.
   * @returns {void} Applies only the selected owned tabindex value; host updates become restoration baselines.
   */
  const write = (node: HTMLElement, value: number) => {
    if (typeof node.setAttribute === 'function') {
      owned.set(node, 'tabindex', String(value));
    }
    if (node.tabIndex !== value) {
      /** Existing property lease reused only while the host has not changed its last value. */
      const old = fallback.get(node);
      /** Property lease capturing the last observed host value and helper write. */
      const record =
        old && node.tabIndex === old.applied
          ? old
          : { before: node.tabIndex, applied: node.tabIndex };
      record.applied = value;
      fallback.set(node, record);
      node.tabIndex = value;
    }
  };
  /** Restore owned tabindex and remove the specific departed item listeners.
   * @param {HTMLElement} node - One current supplier element; writes/listeners belong to this composite owner.
   * @returns {void} Removes only this owner listeners/attributes/lease; foreign speech is never cancelled.
   */
  const release = (node: HTMLElement) => {
    owned.release(node);
    /** Validate bounded own data descriptors without reading getters. */
    const record = fallback.get(node);
    if (record && node.tabIndex === record.applied) {
      node.tabIndex = record.before;
    }
    fallback.delete(node);
    bindings.get(node)?.();
    bindings.delete(node);
  };
  /** Keep exactly the selected available item at zero and every other retained item at minus one.
   * @returns {void} Reflects current state in owned DOM/controls without starting speech or network collection.
   */
  const update = () => {
    // node belongs to the current supplier list; release removed listeners/attributes rather than retaining stale items.
    for (const node of all) {
      write(node, node === current ? 0 : -1);
    }
  };
  /** Reconcile dynamic items/listeners and choose a nearby surviving enabled tab stop.
   * @returns {void} Reconciles current items/backgrounds and releases obsolete ownership.
   */
  const refresh = () => {
    assertLive();
    /** Fresh supplier list; reconciliation never retains deleted source items. */
    const next = list();
    /** Currently enabled items, used for selection bounds and keyboard movement. */
    const available = enabled(next);
    /** Prior item position used to select the nearest surviving enabled entry. */
    const oldIndex = Math.max(0, all.indexOf(current!));
    /** Whether the previously selected item is now absent or unavailable. */
    const removed = !!current && !available.includes(current);
    /** Prior selection document used only to decide whether focus restoration would steal focus. */
    const doc = current?.ownerDocument;
    /** Captured actual focus; removal repair moves it only when focus has not moved elsewhere. */
    const active = doc?.activeElement;
    // node belongs to the current supplier list; release removed listeners/attributes rather than retaining stale items.
    for (const node of all) {
      if (!next.includes(node)) {
        release(node);
      }
    }
    all = next;
    if (!available.includes(current!)) {
      current = available[Math.min(oldIndex, available.length - 1)];
    }
    // node belongs to the current supplier list; release removed listeners/attributes rather than retaining stale items.
    for (const node of all) {
      if (!bindings.has(node) && node.addEventListener) {
        /** Owned item listener updating current selection after actual focus movement.
         * @returns {void} Retains valid focus history or repairs escape only for the top active trap.
         */
        const onFocus = () => {
          if (disposed || !enabled(all).includes(node)) {
            return;
          }
          hadFocus = true;
          current = node;
          update();
        };
        /** Owned item listener distinguishing in-list moves from focus leaving the composite.
         * @param {FocusEvent} event - Borrowed native event; no fabricated trusted user action is created here.
         * @returns {void} Records whether focus has left the composite instead of stealing it back later.
         */
        const onBlur = (event: FocusEvent) => {
          if (
            event.relatedTarget &&
            !all.some(
              (item) =>
                item === event.relatedTarget ||
                item.contains?.(event.relatedTarget as Node)
            )
          ) {
            hadFocus = false;
          }
        };
        node.addEventListener('focusin', onFocus);
        node.addEventListener('focusout', onBlur);
        bindings.set(node, () => {
          node.removeEventListener('focusin', onFocus);
          node.removeEventListener('focusout', onBlur);
        });
      }
    }
    update();
    if (
      removed &&
      hadFocus &&
      current &&
      (!active || active === doc?.body || !active.isConnected)
    ) {
      current.focus();
    }
  };
  /** Owned navigation handler; modifiers/composition and unrelated keys stay native.
   * @param {KeyboardEvent} event - Borrowed native event; no fabricated trusted user action is created here.
   * @returns {void} Handles only relevant active-layer navigation; unrelated/native keys remain untouched.
   */
  const onKey = (event: KeyboardEvent) => {
    if (
      disposed ||
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.isComposing
    ) {
      return;
    }
    let keys: string[];
    if (orientation === 'horizontal') {
      keys = ['ArrowLeft', 'ArrowRight'];
    } else if (orientation === 'vertical') {
      keys = ['ArrowUp', 'ArrowDown'];
    } else {
      keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
    }
    if (
      !keys.includes(event.key) &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return;
    }
    refresh();
    /** Currently enabled items, used for selection bounds and keyboard movement. */
    const available = enabled(all);
    /** Index of the originating item, including events from descendants; negative means unrelated. */
    const selected = available.findIndex(
      (node) => node === event.target || node.contains?.(event.target as Node)
    );
    if (selected < 0) {
      return;
    }
    let next: number;
    if (event.key === 'Home') {
      next = 0;
    } else if (event.key === 'End') {
      next = available.length - 1;
    } else {
      let delta = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
      if (
        options.direction === 'rtl' &&
        ['ArrowLeft', 'ArrowRight'].includes(event.key)
      ) {
        delta = -delta;
      }
      next = selected + delta;
      if (options.loop === false && (next < 0 || next >= available.length)) {
        return;
      }
      next = (next + available.length) % available.length;
    }
    event.preventDefault();
    hadFocus = true;
    current = available[next];
    update();
    current.focus();
  };
  return {
    refresh,
    onKey,
    /** Select an enabled current item programmatically without manufacturing a positive tabindex.
     * @param {number} value - Explicit authored value; validation/ownership depends on the declared method.
     * @returns {void} No value; updates the enabled tab stop. Reconciliation may repair a removed focused item.
     */
    setIndex(value: number) {
      assertLive();
      refresh();
      /** Currently enabled items, used for selection bounds and keyboard movement. */
      const available = enabled(all);
      if (!Number.isInteger(value) || value < 0 || value >= available.length) {
        throw new RangeError('Invalid focus index');
      }
      current = available[value];
      update();
    },
    /** Current enabled selection index, or minus one when no item is selected.
     * @returns {number} Current owner state without granting application privileges.
     */
    get index() {
      assertLive();
      return enabled(list()).indexOf(current!);
    },
    /** Own one container keydown binding; manual onKey listeners remain host-owned.
     * @param {HTMLElement} container - Explicit native event container for this composite.
     * @returns {() => void} Exact unsubscribe callback; destroy also releases active attachments.
     */
    attach(container: HTMLElement) {
      assertLive();
      if (!container || typeof container.addEventListener !== 'function') {
        throw new TypeError('A roving event container is required');
      }
      if (!containers.has(container)) {
        containers.add(container);
        container.addEventListener('keydown', onKey);
      }
      return () => {
        container.removeEventListener('keydown', onKey);
        containers.delete(container);
      };
    },
    /** Release this owner resources; borrowed dependencies remain caller-owned.
     * @returns {void} No value; stops owned listeners, restores owned tabindex values and invalidates this controller.
     */
    destroy() {
      if (disposed) {
        return;
      }
      disposed = true;
      // container was explicitly attached by this controller; remove only its owned key handler.
      for (const container of containers) {
        container.removeEventListener('keydown', onKey);
      }
      containers.clear();
      // node belongs to the current supplier list; release removed listeners/attributes rather than retaining stale items.
      for (const node of all) {
        release(node);
      }
      all = [];
      current = undefined;
    },
  };
}
