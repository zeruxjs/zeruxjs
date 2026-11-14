import { attributeOwner } from './ownership.js';
import { observeReducedMotion } from './aria.js';
import type { PreferenceState } from './preferences.js';
/** Weak document-local safe selector counters; no user identifier is encoded. */
const ids = new WeakMap<Document, number>();
/** Containers with an active owned style binding; duplicate bindings reject. */
const mounted = new WeakSet<HTMLElement>();
/** Allocate a safe per-document DOM token unrelated to user identity.
 * @param {Document} doc - Explicit owning document; default DOM globals are read only when this API is called.
 * @returns {string} Generated selector/control token; no DOM node or observer is allocated here.
 */
export function preferenceId(doc: Document): string {
  /** Next document-local generated ID; not a stable user/session identifier. */
  const next = (ids.get(doc) ?? 0) + 1;
  ids.set(doc, next);
  return 'zx-preference-' + next;
}
/** Bind validated preference state to one container with owned scoped CSS/media listeners.
 * @param {HTMLElement} container - Borrowed explicit container; no whole-document mutation is implied.
 * @param {PreferenceState} state - Borrowed state; the panel/style binding must not destroy it.
 * @param {{ nonce?: string; observeMedia?: boolean }} options - Caller-owned options; see documented fields for defaults, limits and ownership.
 * @param {string} [options.nonce] - Optional host-provided CSP nonce; it is not authorization.
 * @param {boolean} [options.observeMedia] - Observe native media unless false; static CSS media safeguards remain active.
 * @returns {{destroy:()=>void}} Owned binding; destroy releases its CSS/listeners/attributes, not the borrowed state.
 * @throws {TypeError} For invalid nonce/media options or a missing owning DOM window.
 * @throws {Error} For a duplicate container binding or native/borrowed-state setup failure; acquired resources are unwound.
 */
export function bindPreferenceStyles(
  container: HTMLElement,
  state: PreferenceState,
  options: {
    /** Optional host-provided CSP nonce; it is not generated or treated as authorization. */
    /** Optional host-provided CSP nonce; it is not generated or treated as authorization. */
    nonce?: string;
    /** Observe the supplied window media queries unless false; CSS safeguards still apply. */
    /** Observe the supplied window media queries unless false; CSS safeguards still apply. */
    observeMedia?: boolean;
  } = {}
) {
  if (
    options.observeMedia !== undefined &&
    typeof options.observeMedia !== 'boolean'
  ) {
    throw new TypeError('Invalid media observation option');
  }
  if (mounted.has(container)) {
    throw new Error('Preference styles already bound to container');
  }
  /** Container document owning the generated style node and local media context. */
  const doc = container.ownerDocument;
  /** Native view used only when media observation is explicitly enabled/supported. */
  const win = doc.defaultView;
  if (!win) {
    throw new TypeError('Preference styles require a live DOM window');
  }
  if (
    options.nonce !== undefined &&
    (typeof options.nonce !== 'string' ||
      options.nonce.length > 256 ||
      /[\r\n]/.test(options.nonce))
  ) {
    throw new TypeError('Invalid preference style nonce');
  }
  state.getSnapshot();
  /** Scoped data-attribute leases with compare-and-restore cleanup. */
  const owned = attributeOwner();
  /** Generated safe data-attribute token; never interpolates arbitrary labels or content. */
  const token = preferenceId(doc);
  /** Exact generated container selector; CSS does not target the whole document. */
  const selector = `[data-zx-preferences="${token}"]`;
  /** Owned scoped style element, optionally stamped with the host-provided CSP nonce. */
  const style = doc.createElement('style');
  /** Owned state/media unsubscribe callbacks; borrowed state is never destroyed here. */
  const cleanup: (() => void)[] = [];
  if (options.nonce) {
    style.setAttribute('nonce', options.nonce);
  }
  style.setAttribute('data-zx-preference-style', '');
  /** Fixed reduced-motion declarations applied only through the generated scope. */
  const reduce = `
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
    scroll-behavior: auto !important;
  `;
  // Only generated tokens enter selectors; labels/content never become CSS.
  style.textContent = `
${selector}[data-zx-text="125"] { font-size: 125%; }
${selector}[data-zx-text="150"] { font-size: 150%; }
${selector}[data-zx-text="200"] { font-size: 200%; }

${selector}[data-zx-contrast="light"] {
  color: #111;
  background-color: #fff;
  color-scheme: light;
}
${selector}[data-zx-contrast="dark"] {
  color: #fff;
  background-color: #111;
  color-scheme: dark;
}
${selector}[data-zx-contrast="high"] {
  color: #000;
  background-color: #fff;
  color-scheme: light;
}

${selector}:focus-visible,
${selector} :where(button, input, select, textarea, a[href], [tabindex]):focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
${selector}[data-zx-motion="reduce"],
${selector}[data-zx-motion="reduce"] * { ${reduce} }

@media (prefers-reduced-motion: reduce) {
  ${selector}, ${selector} * { ${reduce} }
}
@media (forced-colors: active) {
  ${selector}[data-zx-contrast] {
    color: CanvasText;
    background-color: Canvas;
    color-scheme: normal;
  }
  ${selector}:focus-visible,
  ${selector} :where(button, input, select, textarea, a[href], [tabindex]):focus-visible {
    outline-color: Highlight;
  }
}`;
  /** Project the current validated snapshot into owned container attributes.
   * @returns {void} Reflects current state in owned DOM/controls without starting speech or network collection.
   */
  const update = () => {
    /** Borrowed state view; reading it does not initiate speech or remote collection. */
    const snapshot = state.getSnapshot();
    owned.set(container, 'data-zx-preferences', token);
    owned.set(
      container,
      'data-zx-text',
      String(snapshot.values.textScale * 100)
    );
    owned.set(container, 'data-zx-contrast', snapshot.values.contrast);
    owned.set(
      container,
      'data-zx-motion',
      snapshot.effective.reducedMotion ? 'reduce' : 'system'
    );
  };
  try {
    mounted.add(container);
    container.appendChild(style);
    update();
    cleanup.push(state.subscribe(update));
    if (
      options.observeMedia !== false &&
      typeof win.matchMedia === 'function'
    ) {
      cleanup.push(
        observeReducedMotion(
          (reducedMotion) => state.setSystem({ reducedMotion }),
          win
        )
      );
      /** Native forced-colors media query for this container window. */
      const colors = win.matchMedia('(forced-colors: active)');
      /** Owned forced-colors callback; retained remover releases this exact listener.
       * @returns {void} Project the current native forced-colors flag into the borrowed state.
       */
      const changed = () => state.setSystem({ forcedColors: colors.matches });
      changed();
      colors.addEventListener('change', changed);
      cleanup.push(() => colors.removeEventListener('change', changed));
    }
  } catch (error) {
    // stop belongs to this container binding; borrowed state remains alive after unsubscription.
    for (const stop of cleanup.reverse()) {
      stop();
    }
    style.remove();
    owned.release();
    mounted.delete(container);
    throw error;
  }
  let disposed = false;
  return {
    /** Release this owner resources; borrowed dependencies remain caller-owned.
     * @returns {void} No value; removes owned CSS/media/state subscriptions and restores scoped attributes.
     */
    destroy() {
      if (disposed) {
        return;
      }
      disposed = true;
      // stop belongs to this container binding; borrowed state remains alive after unsubscription.
      for (const stop of cleanup.reverse()) {
        stop();
      }
      style.remove();
      owned.release();
      mounted.delete(container);
    },
  };
}
