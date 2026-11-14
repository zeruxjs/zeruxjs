import { createFocusTrap, type FocusTrapOptions } from './focus.js';
import { attributeOwner } from './ownership.js';
import {
  AccessibilityValidationError,
  validateComponentProps,
} from './props.js';
/** Custom-modal policy preserving authored roles and explicitly scoped background ownership. */
export interface AccessibleDialogOptions {
  /** Authored whitespace-separated naming IDs; actual same-root targets must exist. */
  labelledBy?: string;
  /** Authored description IDs; text is not synthesized or copied into diagnostics. */
  describedBy?: string;
  /** Explicit nonblank authored accessible name; inserted as text/attribute data, not HTML. */
  label?: string;
  /** Close only the top active dialog unless false; defaults to true. */
  closeOnEscape?: boolean;
  /** Host callback invoked for Escape closing; explicit close/destroy do not call it. */
  onClose?: () => void;
  /** Focus-trap options cloned for this dialog; Escape remains owned by the modal layer. */
  focus?: FocusTrapOptions;
  /** Explicit native inert policy. true computes siblings along the ancestor path. */
  inertBackground?: boolean | readonly HTMLElement[];
}
/** Private managed dialog registration and its explicit background policy. */
interface Modal {
  /** Owned/borrowed element for this registration; surrounding markup remains host-authored. */
  element: HTMLElement;
  /** Explicit inert-background policy for this modal owner. */
  policy: AccessibleDialogOptions['inertBackground'];
  /** Owner callback closing this registered modal without cross-document effects. */
  close: () => void;
}
/** Document-local modal stack and compare-and-restore inert leases. */
interface ModalState {
  /** Current document-local modal stack; no unrelated document shares it. */
  entries: Modal[];
  /** Compare-and-restore attribute lease owner for this scope. */
  owned: ReturnType<typeof attributeOwner>;
  /** Regions whose inert attribute is currently helper-owned. */
  applied: Set<HTMLElement>;
}
/** Weak document-local modal ownership; separate documents never share inert leases. */
const modals = new WeakMap<Document, ModalState>();
/** Resolve one document-local modal registry without applying inert attributes.
 * @param {Document} doc - Explicit owning document; default DOM globals are read only when this API is called.
 * @returns {ModalState} Existing or fresh modal ownership state for this document only.
 */
function stateFor(doc: Document): ModalState {
  let state = modals.get(doc);
  if (!state) {
    state = { entries: [], owned: attributeOwner(), applied: new Set() };
    modals.set(doc, state);
  }
  return state;
}
/** Collect sibling background branches around the active custom modal.
 * @param {HTMLElement} element - Borrowed explicit DOM element; caller owns its markup and semantic relationships.
 * @returns {HTMLElement[]} Ancestor-path sibling candidates; a result over 1,024 elements rejects.
 */
function backgrounds(element: HTMLElement): HTMLElement[] {
  /** Sibling background candidates discovered along the current modal ancestor branch. */
  const result: HTMLElement[] = [];
  let branch: HTMLElement | null = element;
  while (branch?.parentElement) {
    // sibling is a real ancestor-path background candidate, never the active branch itself.
    for (const sibling of branch.parentElement.children) {
      if (sibling !== branch) {
        result.push(sibling as HTMLElement);
      }
    }
    branch = branch.parentElement;
    if (branch === element.ownerDocument.body) {
      break;
    }
  }
  if (result.length > 1024) {
    throw new RangeError('Dialog background budget exceeded');
  }
  return result;
}
/** Reconcile only helper-owned inert leases against the current top modal.
 * @param {ModalState} state - Borrowed state; the panel/style binding must not destroy it.
 * @returns {void} Releases obsolete owned inert state and applies newly required regions.
 */
function synchronize(state: ModalState): void {
  /** Top managed modal; only its active branch must remain interactive. */
  const top = state.entries.at(-1);
  /** Current helper-owned background set, recomputed when nesting changes. */
  const desired = new Set<HTMLElement>();
  if (top) {
    if (state.entries.some((entry) => entry.policy === true)) {
      // target belongs to the computed/explicit current inert policy; only owned writes are reconciled.
      for (const target of backgrounds(top.element)) {
        desired.add(target);
      }
    }
    // entry is a current managed modal; preserve other active layers while changing this one.
    for (const entry of state.entries) {
      if (Array.isArray(entry.policy)) {
        // target belongs to the computed/explicit current inert policy; only owned writes are reconciled.
        for (const target of entry.policy) {
          if (
            target !== top.element &&
            !target.contains(top.element) &&
            !top.element.contains(target)
          ) {
            desired.add(target);
          }
        }
      }
    }
  }
  // target belongs to the computed/explicit current inert policy; only owned writes are reconciled.
  for (const target of state.applied) {
    if (!desired.has(target)) {
      state.owned.release(target);
      state.applied.delete(target);
    }
  }
  // target belongs to the computed/explicit current inert policy; only owned writes are reconciled.
  for (const target of desired) {
    if (!state.applied.has(target)) {
      state.owned.set(target, 'inert', '');
      state.applied.add(target);
    }
  }
}
/** Create a managed custom modal preserving compatible authored roles and hidden ownership.
 * @param {HTMLElement} element - Borrowed explicit DOM element; caller owns its markup and semantic relationships.
 * @param {AccessibleDialogOptions} options - Caller-owned options; see documented fields for defaults, limits and ownership.
 * @returns {{readonly open:boolean,show:()=>void,refresh:()=>void,close:()=>void,destroy:()=>void}} Initially hidden owned modal handle; call show explicitly and destroy on teardown.
 * @throws {TypeError} For incompatible authored roles, malformed labels or invalid background policy.
 */
export function createAccessibleDialog(
  element: HTMLElement,
  options: AccessibleDialogOptions = {}
) {
  options = {
    ...options,
    ...(Array.isArray(options.inertBackground)
      ? { inertBackground: [...options.inertBackground] }
      : {}),
  };
  /** Owning document for this element, listeners and modal stack. */
  const doc = element.ownerDocument;
  /** Authored role inspected before any helper writes; incompatible roles reject. */
  const existingRole = element.getAttribute('role');
  if (existingRole && !['dialog', 'alertdialog'].includes(existingRole)) {
    throw new TypeError(
      'Modal requires an authored dialog or alertdialog role'
    );
  }
  if (
    options.inertBackground !== undefined &&
    typeof options.inertBackground !== 'boolean' &&
    (!Array.isArray(options.inertBackground) ||
      options.inertBackground.length > 256 ||
      options.inertBackground.some(
        (target) =>
          target.ownerDocument !== doc || typeof target.contains !== 'function'
      ))
  ) {
    throw new TypeError('Invalid dialog inert background');
  }
  let originalHidden = element.hidden;
  /** Instance attribute lease; compare-and-restore preserves different host updates. */
  const owned = attributeOwner();
  let appliedHidden = element.hidden;
  /** Whether native hidden reflects the actual attribute; legacy mocks use a property fallback. */
  const reflectedHidden =
    !!doc.defaultView && element instanceof doc.defaultView.HTMLElement;
  /** Write visibility while tracking this helper ownership and preserving observed host changes.
   * @param {boolean} value - Explicit input/attribute value; validation and effect are described by this helper.
   * @returns {void} Updates helper visibility ownership without overwriting later host state on disposal.
   */
  const hidden = (value: boolean) => {
    if (reflectedHidden) {
      owned.set(element, 'hidden', value ? '' : null);
    } else {
      if (element.hidden !== appliedHidden) {
        originalHidden = element.hidden;
      }
      element.hidden = value;
    }
    appliedHidden = element.hidden;
  };
  if (!existingRole) {
    owned.set(element, 'role', 'dialog');
  }
  owned.set(element, 'aria-modal', 'true');
  // Each known option/attribute pair projects authored names, never arbitrary HTML.
  for (const [option, attribute] of [
    ['label', 'aria-label'],
    ['labelledBy', 'aria-labelledby'],
    ['describedBy', 'aria-describedby'],
  ] as const) {
    /** Authored label/reference value checked before writing its owned ARIA attribute. */
    const value = options[option];
    if (value !== undefined) {
      if (typeof value !== 'string' || !value.trim() || value.length > 1024) {
        owned.release();
        throw new TypeError('Invalid dialog label/reference');
      }
      owned.set(element, attribute, value);
    }
  }
  let disposed = false,
    open = false,
    opener: HTMLElement | null = null;
  /** Document-local modal registry reused only by dialogs in this same document. */
  const state = stateFor(doc);
  /** Owned nested focus trap; the dialog closes it before relinquishing modal state. */
  const focus = createFocusTrap(element, {
    ...options.focus,
    returnFocusTo: options.focus?.returnFocusTo ?? (() => opener),
    escapeDeactivates: false,
  });
  /** This dialog registration, retaining its explicit background policy and close callback. */
  const modal: Modal = {
    element,
    policy: options.inertBackground,
    close: () => api.close(),
  };
  /** Owned Escape listener; only the active topmost dialog handles the event.
   * @param {KeyboardEvent} event - Borrowed native event; no fabricated trusted user action is created here.
   * @returns {void} Handles only relevant active-layer navigation; unrelated/native keys remain untouched.
   */
  const onKey = (event: KeyboardEvent) => {
    if (
      event.key === 'Escape' &&
      !event.defaultPrevented &&
      open &&
      focus.topmost &&
      options.closeOnEscape !== false
    ) {
      event.preventDefault();
      api.close();
      options.onClose?.();
    }
  };
  /** Instance-scoped modal handle; destroy permanently closes this custom-dialog owner. */
  const api = {
    /** Current enabled selection index, or minus one when no item is selected.
     * @returns {boolean} Current owner state without granting application privileges.
     */
    get open() {
      return open;
    },
    /** Validate current references and acquire modal/inert/focus ownership explicitly.
     * @returns {void} No value; acquires a closed modal. Already-open calls do not reorder its stack position.
     */
    show() {
      if (disposed) {
        throw new Error('Dialog destroyed');
      }
      if (open) {
        return;
      }
      if (
        !['dialog', 'alertdialog'].includes(element.getAttribute('role') ?? '')
      ) {
        throw new TypeError('Dialog role changed while managed');
      }
      // Real DOM trees validate references at show time, so construction may precede mounting.
      if (typeof doc.querySelectorAll === 'function') {
        /** Redacted component/reference issues checked before modal activation or refresh. */
        const issues = validateComponentProps(element, {});
        if (issues.length) {
          throw new AccessibilityValidationError(issues);
        }
      }
      if (state.entries.length >= 128) {
        throw new RangeError('Dialog nesting budget exceeded');
      }
      opener = doc.activeElement as HTMLElement | null;
      hidden(false);
      open = true;
      state.entries.push(modal);
      try {
        synchronize(state);
        doc.addEventListener('keydown', onKey);
        focus.activate();
      } catch (error) {
        open = false;
        /** Current registration position removed without disturbing other active dialogs. */
        const index = state.entries.indexOf(modal);
        if (index >= 0) {
          state.entries.splice(index, 1);
        }
        doc.removeEventListener('keydown', onKey);
        focus.destroy();
        synchronize(state);
        hidden(true);
        throw error;
      }
    },
    /** Reconcile current DOM/list state without reusing removed nodes or inventing relationships.
     * @returns {void} No value; updates current inert/reference policy while open and otherwise leaves it alone.
     */
    refresh() {
      if (open) {
        synchronize(state);
        if (typeof doc.querySelectorAll === 'function') {
          /** Redacted component/reference issues checked before modal activation or refresh. */
          const issues = validateComponentProps(element, {});
          if (issues.length) {
            throw new AccessibilityValidationError(issues);
          }
        }
      }
    },
    /** Close this dialog and managed DOM descendants, then restore available focus.
     * @returns {void} No value; closes managed DOM descendants, releases modal/focus ownership and hides this element.
     */
    close() {
      if (!open) {
        return;
      }
      // Removing a DOM ancestor must not strand live traps inside its hidden subtree.
      // entry is a current managed modal; preserve other active layers while changing this one.
      for (const entry of [...state.entries].reverse()) {
        if (entry !== modal && element.contains(entry.element)) {
          entry.close();
        }
      }
      open = false;
      /** Current registration position removed without disturbing other active dialogs. */
      const index = state.entries.indexOf(modal);
      if (index >= 0) {
        state.entries.splice(index, 1);
      }
      doc.removeEventListener('keydown', onKey);
      synchronize(state);
      try {
        focus.deactivate();
      } finally {
        hidden(true);
      }
    },
    /** Release this owner resources; borrowed dependencies remain caller-owned.
     * @returns {void} No value; permanently closes this dialog owner and compare-and-restores authored attributes.
     */
    destroy() {
      if (disposed) {
        return;
      }
      try {
        api.close();
      } finally {
        disposed = true;
        owned.release();
        if (!reflectedHidden && element.hidden === appliedHidden) {
          element.hidden = originalHidden;
        }
        focus.destroy();
      }
    },
  };
  hidden(true);
  return api;
}
