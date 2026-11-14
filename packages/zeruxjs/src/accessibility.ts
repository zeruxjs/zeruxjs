/** Small browser-only progressive enhancement; safe to import during SSR. */
export interface AccessibleTabs {
  /** Select a valid enabled tab, optionally moving focus; invalid requests are ignored.
   * @param {number} index - Requested captured tab index.
   * @param {boolean} focus - Whether native focus should follow selection.
   * @returns {void} Selection update while the binding is active.
   */
  select(index: number, focus?: boolean): void;
  /** Remove this binding’s click and keyboard listeners; existing selected DOM state remains authored output.
   * @returns {void} Idempotent listener cleanup completion.
   */
  destroy(): void;
}
/** Bind fixed authored ARIA tab/panel relationships with managed roving tabindex; no IDs or labels are invented.
 * @param {HTMLElement} tabList - Host-owned tablist containing authored tab elements.
 * @param {object} options - Optional orientation and text direction overrides.
 * @param {string} options.orientation - Optional horizontal/vertical keyboard axis.
 * @param {string} options.direction - Optional ltr/rtl navigation direction.
 * @returns {AccessibleTabs} Owned listener binding; call destroy before discarding the tablist.
 */
export function bindAccessibleTabs(
  tabList: HTMLElement,
  options: {
    /** Explicit keyboard axis, otherwise the authored aria-orientation is used. */
    orientation?: 'horizontal' | 'vertical';
    /** Explicit text direction, otherwise computed tablist direction is used. */
    direction?: 'ltr' | 'rtl';
  } = {}
): AccessibleTabs {
  /** Fixed tab collection captured at binding time; dynamic list changes require rebinding. */
  const tabs = [...tabList.querySelectorAll<HTMLElement>('[role="tab"]')];
  /** Owner document used to resolve authored panel ID references. */
  const doc = tabList.ownerDocument;
  if (!tabs.length) {
    throw new Error('Tabs require at least one role=tab element');
  }
  /** One validated panel per tab, preserving authored role and label relationships. */
  const panels = tabs.map((tab) => {
    /** Authored aria-controls reference; no synthetic label or identifier is invented. */
    const id = tab.getAttribute('aria-controls');
    /** Owner-document target required to match this tab’s authored label relationship. */
    const panel = id ? doc.getElementById(id) : null;
    if (
      !panel ||
      panel.getAttribute('role') !== 'tabpanel' ||
      !tab.id ||
      !doc.contains(panel) ||
      panel.getAttribute('aria-labelledby') !== tab.id
    ) {
      throw new Error(
        'Each tab must identify a role=tabpanel with matching aria-labelledby'
      );
    }
    return panel;
  });
  if (new Set(panels).size !== panels.length) {
    throw new Error('Tabs cannot share a tabpanel');
  }
  // Internal callers use bounded tab indexes; select validates public indexes first.
  /** Check disabled semantics for a previously bounded tab index.
   * @param {number} i - Internal validated tab index.
   * @returns {boolean} Whether the tab permits selection.
   */
  const enabled = (i: number) =>
    !tabs[i]!.hasAttribute('disabled') &&
    tabs[i]!.getAttribute('aria-disabled') !== 'true';
  let selected = tabs.findIndex(
    (tab, i) => enabled(i) && tab.getAttribute('aria-selected') === 'true'
  );
  if (selected < 0) {
    selected = tabs.findIndex((_tab, i) => enabled(i));
  }
  if (selected < 0) {
    throw new Error('Tabs require an enabled tab');
  }
  let destroyed = false;
  /** Select a bounded enabled tab and optionally move native focus.
   * @param {number} i - Requested tab index; invalid indexes are ignored.
   * @param {boolean} focus - Whether keyboard-style focus should follow selection.
   * @returns {void} Tab/panel state update while this binding is active.
   */
  const select = (i: number, focus = false) => {
    if (
      destroyed ||
      !Number.isInteger(i) ||
      i < 0 ||
      i >= tabs.length ||
      !enabled(i)
    ) {
      return;
    }
    selected = i;
    // panels is created one-for-one with tabs above.
    tabs.forEach((tab, j) => {
      tab.setAttribute('aria-selected', String(j === i));
      tab.tabIndex = j === i ? 0 : -1;
      panels[j]!.hidden = j !== i;
    });
    if (focus) {
      tabs[i]!.focus();
    }
  };
  /** Resolve an event target to a captured tab or its descendant.
   * @param {EventTarget | null} target - Native event target.
   * @returns {number} Matching tab index, or minus one.
   */
  const indexFrom = (target: EventTarget | null) =>
    tabs.findIndex(
      (tab) =>
        target === tab ||
        (typeof Node !== 'undefined' &&
          target instanceof Node &&
          tab.contains(target))
    );
  /** Apply pointer selection only when the target belongs to this tab list.
   * @param {MouseEvent} event - Borrowed bubbling click event.
   * @returns {void} Optional selection update.
   */
  const click = (event: MouseEvent) => {
    /** Captured tab index for the current event target. */
    const i = indexFrom(event.target);
    if (i >= 0) {
      select(i);
    }
  };
  /** Apply authored orientation and direction to native tab keyboard navigation.
   * @param {KeyboardEvent} event - Borrowed keyboard event.
   * @returns {void} Prevent default only for handled navigation keys.
   */
  const keydown = (event: KeyboardEvent) => {
    /** Captured tab index for the current event target. */
    const i = indexFrom(event.target);
    if (i < 0 || !enabled(i)) {
      return;
    }
    /** Explicit or authored vertical orientation used to choose supported arrow keys. */
    const vertical =
      options.orientation === 'vertical' ||
      tabList.getAttribute('aria-orientation') === 'vertical';
    /** Explicit direction or computed owner-document direction; no global direction mutation. */
    const direction =
      options.direction ??
      (doc.defaultView?.getComputedStyle(tabList).direction === 'rtl'
        ? 'rtl'
        : 'ltr');
    let step = 0;
    if (vertical) {
      if (event.key === 'ArrowDown') {
        step = 1;
      } else if (event.key === 'ArrowUp') {
        step = -1;
      }
    } else {
      if (event.key === 'ArrowRight') {
        step = direction === 'rtl' ? -1 : 1;
      } else if (event.key === 'ArrowLeft') {
        step = direction === 'rtl' ? 1 : -1;
      }
    }
    let next = i;
    if (event.key === 'Home') {
      next = tabs.findIndex((_tab, j) => enabled(j));
    } else if (event.key === 'End') {
      for (let j = tabs.length - 1; j >= 0; j--) {
        if (enabled(j)) {
          next = j;
          break;
        }
      }
    } else if (step) {
      do {
        next = (next + step + tabs.length) % tabs.length;
      } while (!enabled(next) && next !== i);
    } else {
      return;
    }
    event.preventDefault();
    select(next, true);
  };
  tabList.addEventListener('click', click);
  tabList.addEventListener('keydown', keydown);
  select(selected);
  return {
    select,
    /** Remove this binding’s click and keyboard listeners; existing selected DOM state remains authored output.
     * @returns {void} Idempotent listener cleanup completion.
     */
    destroy() {
      if (destroyed) {
        return;
      }
      destroyed = true;
      tabList.removeEventListener('click', click);
      tabList.removeEventListener('keydown', keydown);
    },
  };
}
/** Read an optional media preference without accessing a missing browser global.
 * @param {Pick<Window, 'matchMedia'> | undefined} win - Optional host window-like object, default the available browser window.
 * @returns {boolean} Whether reduced motion is requested; false does not authorize forced animation.
 */
export function prefersReducedMotion(
  win: Pick<Window, 'matchMedia'> | undefined = typeof window === 'undefined'
    ? undefined
    : window
): boolean {
  return Boolean(win?.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}
