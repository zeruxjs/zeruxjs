import type { FocusTrap } from './types.js';
import { attributeOwner } from './ownership.js';
/** Native focusable candidates; actual availability and layout are checked separately. */
const selector = 'a[href],button,input,select,textarea,[tabindex]';
/** Check connected/native/ancestor visibility and disabled semantics without moving focus.
 * @param {HTMLElement} element - Borrowed explicit DOM element; caller owns its markup and semantic relationships.
 * @returns {boolean} Semantic availability only; this predicate does not require positive layout geometry.
 */
export function isFocusAvailable(element: HTMLElement): boolean {
  if (
    element.isConnected === false ||
    element.hidden ||
    element.getAttribute?.('aria-disabled') === 'true' ||
    element.hasAttribute?.('disabled') ||
    element.getAttribute?.('type') === 'hidden'
  ) {
    return false;
  }
  if (
    element.closest?.(
      '[hidden],[inert],[aria-hidden="true"],[aria-disabled="true"]'
    )
  ) {
    return false;
  }
  if (element.matches?.(':disabled')) {
    return false;
  }
  /** Computed visibility only; geometry is checked by focusableElements rather than this predicate. */
  const style = element.ownerDocument?.defaultView?.getComputedStyle(element);
  return (
    !style ||
    (style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.visibility !== 'collapse')
  );
}
/** Read rendered native tab stops in DOM order without changing their tabindex.
 * @param {HTMLElement} container - Borrowed explicit container; no whole-document mutation is implied.
 * @returns {HTMLElement[]} Fresh focusable candidates with nonnegative tabindex and available layout rectangles.
 */
export function focusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(selector)].filter(
    (el) =>
      typeof el.focus === 'function' &&
      el.tabIndex >= 0 &&
      isFocusAvailable(el) &&
      el.getClientRects().length > 0
  );
}
/** Private active-trap registration with a lazily resolved constructed handle. */
interface Entry {
  /** Borrowed trap handle belonging to this document-local registration. */
  trap: FocusTrap;
  /** Explicit scope containing valid focus targets. */
  container: HTMLElement;
  /** Owner callback restoring focus within this active trap. */
  focus: () => void;
}
/** Weak document-local trap stacks; callers must deactivate/destroy active listeners. */
const stacks = new WeakMap<Document, Entry[]>();
/** Explicit in-trap selection and available-opener restoration policy. */
export interface FocusTrapOptions {
  /** Optional initial in-trap target supplier, evaluated only on activation. */
  initialFocus?: () => HTMLElement | null;
  /** Optional in-trap fallback when no remembered/rendered tab stop is available. */
  fallbackFocus?: () => HTMLElement | null;
  /** Restore an available opener/fallback on deactivation unless false; defaults to true. */
  returnFocus?: boolean;
  /** Optional explicit restoration supplier; invalid/outside-parent candidates are not focused. */
  returnFocusTo?: () => HTMLElement | null;
  /** Logical host fallback when the captured opener is removed/unavailable. */
  returnFocusFallback?: () => HTMLElement | null;
  /** Deactivate this trap for Escape when true; defaults to false. Dialogs own Escape separately. */
  escapeDeactivates?: boolean;
  /** Optional callback before Escape deactivation; trap cleanup still runs if it throws. */
  onEscape?: (event: KeyboardEvent) => void;
}
/** Create an inactive document-local focus owner with explicit restoration policy.
 * @param {HTMLElement} container - Borrowed explicit container; no whole-document mutation is implied.
 * @param {FocusTrapOptions} options - Caller-owned options; see documented fields for defaults, limits and ownership.
 * @returns {FocusTrap} Reusable inactive trap; activation acquires listeners and destroy only deactivates them.
 */
export function createFocusTrap(
  container: HTMLElement,
  options: FocusTrapOptions = {}
): FocusTrap {
  options = { ...options };
  /** Owning document used for focus history and instance event listeners. */
  const doc = container.ownerDocument;
  let previous: HTMLElement | null = null,
    active = false,
    redirecting = false,
    lastFocused: HTMLElement | null = null;
  /** Temporary tabindex ownership; the helper writes minus one only when needed. */
  const owned = attributeOwner();
  /** Resolve this document stack lazily; other documents retain independent ownership.
   * @returns {Entry[]} This document trap stack; no other document ownership is shared.
   */
  const stack = () => {
    let value = stacks.get(doc);
    if (!value) {
      value = [];
      stacks.set(doc, value);
    }
    return value;
  };
  /** Whether this instance is the current top focus owner.
   * @returns {boolean} Whether this trap currently owns the top active layer.
   */
  const top = () => stack().at(-1)?.trap === trap;
  /** Move focus only inside the trap, with guarded reentrancy and explicit fallback policy.
   * @param {boolean} initial - Whether activation may use initialFocus before remembered/first/fallback focus.
   * @returns {void} Focuses a validated in-trap target and restores the reentrancy guard even on failure.
   */
  const focus = (initial = false) => {
    if (redirecting) {
      return;
    }
    redirecting = true;
    try {
      // Initial selection and remembered focus have distinct ownership/availability checks.
      let preferred: HTMLElement | null | undefined;
      if (initial) {
        preferred = options.initialFocus?.();
      } else if (lastFocused && isFocusAvailable(lastFocused)) {
        preferred = lastFocused;
      }
      /** Candidate after initial/remembered/first/fallback selection; validate before focusing. */
      const selected =
        preferred ??
        focusableElements(container)[0] ??
        options.fallbackFocus?.() ??
        container;
      if (
        !selected ||
        typeof selected.focus !== 'function' ||
        !container.contains(selected) ||
        !isFocusAvailable(selected)
      ) {
        throw new TypeError('Focus target must be available inside the trap');
      }
      if (selected === container && !container.hasAttribute('tabindex')) {
        owned.set(container, 'tabindex', '-1');
      }
      selected.focus();
      lastFocused = selected;
    } finally {
      redirecting = false;
    }
  };
  /** Owned keyboard handler; nested traps below the top layer do not intercept input.
   * @param {KeyboardEvent} event - Borrowed native event; no fabricated trusted user action is created here.
   * @returns {void} Handles only relevant active-layer navigation; unrelated/native keys remain untouched.
   */
  const onKey = (event: KeyboardEvent) => {
    if (!active || !top() || event.defaultPrevented) {
      return;
    }
    if (event.key === 'Escape' && options.escapeDeactivates) {
      try {
        options.onEscape?.(event);
      } finally {
        trap.deactivate();
      }
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    /** Available rendered tab stops in DOM order; no positive tabindex is generated. */
    const nodes = focusableElements(container);
    if (!nodes.length) {
      event.preventDefault();
      focus();
      return;
    }
    /** First available native tab stop, used for forward wraparound. */
    const first = nodes[0];
    /** Last available native tab stop, used for backward wraparound. */
    const last = nodes[nodes.length - 1];
    /** Current document focus, compared before preventing native Tab navigation. */
    const current = doc.activeElement;
    if (event.shiftKey && (current === first || !container.contains(current))) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (current === last || !container.contains(current))
    ) {
      event.preventDefault();
      first.focus();
    }
  };
  /** Owned focusin handler; retain an in-trap target or redirect outside focus.
   * @param {FocusEvent} event - Borrowed native event; no fabricated trusted user action is created here.
   * @returns {void} Retains valid focus history or repairs escape only for the top active trap.
   */
  const onFocus = (event: FocusEvent) => {
    if (!active || !top() || redirecting || !event.target) {
      return;
    }
    if (container.contains(event.target as Node)) {
      if (typeof (event.target as HTMLElement).focus === 'function') {
        lastFocused = event.target as HTMLElement;
      }
    } else {
      focus();
    }
  };
  /** Stack registration with a lazy trap getter so construction has no activation side effect. */
  const entry: Entry = {
    /** Borrowed trap handle belonging to this document-local registration.
     * @returns {FocusTrap} Constructed trap handle; no activation occurs merely by reading this registration.
     */
    get trap() {
      return trap;
    },
    container,
    focus: () => focus(),
  };
  /** Reusable trap handle; destroy deactivates rather than permanently invalidating it. */
  const trap: FocusTrap = {
    /** Whether this owner currently has an active trap/utterance; not a permission grant.
     * @returns {boolean} Current owner state without granting application privileges.
     */
    get active() {
      return active;
    },
    /** Whether this active trap alone owns focus interception in its document.
     * @returns {boolean} Current owner state without granting application privileges.
     */
    get topmost() {
      return active && top();
    },
    /** Acquire top-layer listeners and initial focus; activation failure rolls back this owner.
     * @returns {void} No value; acquires listeners/initial focus only when inactive, rolling back failed acquisition.
     */
    activate() {
      if (active) {
        return;
      }
      previous = doc.activeElement as HTMLElement | null;
      active = true;
      stack().push(entry);
      try {
        doc.addEventListener('keydown', onKey);
        doc.addEventListener('focusin', onFocus);
        focus(true);
      } catch (error) {
        active = false;
        stack().splice(stack().indexOf(entry), 1);
        doc.removeEventListener('keydown', onKey);
        doc.removeEventListener('focusin', onFocus);
        owned.release();
        throw error;
      }
    },
    /** Release this active trap and restore available focus only when it owned the top layer.
     * @returns {void} No value; releases this active registration and restores only compatible available focus.
     */
    deactivate() {
      if (!active) {
        return;
      }
      /** Restoration is allowed only for the trap that actually owned the top layer. */
      const wasTop = top();
      active = false;
      /** Current stack position; removing a lower layer must not steal top-layer focus. */
      const index = stack().indexOf(entry);
      if (index >= 0) {
        stack().splice(index, 1);
      }
      doc.removeEventListener('keydown', onKey);
      doc.removeEventListener('focusin', onFocus);
      owned.release();
      if (!wasTop || options.returnFocus === false) {
        return;
      }
      /** Remaining enclosing trap constraining any restoration target. */
      const parent = stack().at(-1);
      /** Explicit restoration target or captured opener; availability is rechecked on close. */
      const candidate = options.returnFocusTo?.() ?? previous;
      /** Available compatible restoration target, otherwise the enclosing trap owns fallback. */
      const target =
        candidate &&
        isFocusAvailable(candidate) &&
        (!parent || parent.container.contains(candidate))
          ? candidate
          : options.returnFocusFallback?.();
      if (
        target &&
        isFocusAvailable(target) &&
        (!parent || parent.container.contains(target))
      ) {
        target.focus();
      } else {
        parent?.focus();
      }
    },
    /** Release this owner resources; borrowed dependencies remain caller-owned.
     * @returns {void} No value; delegates to deactivate. A later explicit activate remains supported.
     */
    destroy() {
      trap.deactivate();
    },
  };
  return trap;
}
/** Attach one keydown adapter for Escape without capturing unrelated keys.
 * @param {EventTarget} target - Explicit native event target; the caller owns its surrounding lifecycle.
 * @param {(event: KeyboardEvent) => void} callback - Borrowed host callback; no server authorization is inferred from UI state.
 * @returns {() => void} Exact listener remover; the callback owns any application action.
 */
export function onEscape(
  target: EventTarget,
  callback: (event: KeyboardEvent) => void
): () => void {
  /** Owned Escape event adapter; its returned disposer removes this exact callback.
   * @param {Event} event - Borrowed native event; no fabricated trusted user action is created here.
   * @returns {void} Calls the borrowed handler only for Escape; no default action is manufactured.
   */
  const handler = (event: Event) => {
    /** Borrowed keyboard event; non-Escape keys remain untouched. */
    const key = event as KeyboardEvent;
    if (key.key === 'Escape') {
      callback(key);
    }
  };
  target.addEventListener('keydown', handler);
  return () => target.removeEventListener('keydown', handler);
}
