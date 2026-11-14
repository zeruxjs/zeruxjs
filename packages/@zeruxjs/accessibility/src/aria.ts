/** Convert a typed boolean to an ARIA boolean token without touching the DOM.
 * @param {boolean} value - Typed boolean state; JavaScript callers remain responsible for validating runtime inputs.
 * @returns {'true' | 'false'} true or false string selected by the supplied boolean.
 */
export function ariaBoolean(value: boolean): 'true' | 'false' {
  return value ? 'true' : 'false';
}
/** Return a fresh visually-hidden declaration record; no styles are applied on import.
 * @returns {Readonly<Record<string,string>>} Fresh style data for an explicitly owned element; readonly typing is not a frozen DOM stylesheet.
 */
export function visuallyHiddenStyle(): Readonly<Record<string, string>> {
  return {
    position: 'absolute',
    width: '1px',
    height: '1px',
    padding: '0',
    margin: '-1px',
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    border: '0',
  };
}
/** Set only the explicit aria-expanded state on the supplied element.
 * @param {Element} element - Borrowed explicit DOM element; caller owns its markup and semantic relationships.
 * @param {boolean} expanded - Authored expanded state, not inferred from arbitrary markup.
 * @returns {void} No value; the caller retains semantic relationship and lifecycle ownership.
 */
export function setAriaExpanded(element: Element, expanded: boolean): void {
  element.setAttribute('aria-expanded', ariaBoolean(expanded));
}
/** Set only the explicit aria-pressed state on the supplied element.
 * @param {Element} element - Borrowed explicit DOM element; caller owns its markup and semantic relationships.
 * @param {boolean} pressed - Authored pressed state; activation remains component-owned.
 * @returns {void} No value; native activation and role validity remain component responsibilities.
 */
export function setAriaPressed(element: Element, pressed: boolean): void {
  element.setAttribute('aria-pressed', ariaBoolean(pressed));
}
/** Set only the explicit aria-busy state on the supplied element.
 * @param {Element} element - Borrowed explicit DOM element; caller owns its markup and semantic relationships.
 * @param {boolean} busy - Authored busy state; not a server authorization or admission mechanism.
 * @returns {void} No value; this state does not block or authorize application work.
 */
export function setAriaBusy(element: Element, busy: boolean): void {
  element.setAttribute('aria-busy', ariaBoolean(busy));
}
/** Read the current global media capability only when explicitly called.
 * @returns {boolean} Whether matchMedia exists and currently reports reduced motion.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia !== 'undefined' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
/** Deliver current/system motion state and own one media change subscription.
 * @param {(reduced: boolean) => void} listener - Borrowed synchronous observer; the returned disposer owns only its subscription.
 * @param {Window} win - Borrowed realm for native feature detection/events; not a new browser process.
 * @returns {() => void} Exact unsubscribe callback; no polling, persistence or remote requests occur.
 * @throws {Error} Propagates native media API/initial listener failures; no polyfill is installed.
 */
export function observeReducedMotion(
  listener: (reduced: boolean) => void,
  win: Window = window
): () => void {
  /** Install deterministic matchMedia only into the explicitly supplied fixture realm. */
  const media = win.matchMedia('(prefers-reduced-motion: reduce)');
  listener(media.matches);
  /** Owned media-change callback; returned disposer removes this exact listener.
   * @param {MediaQueryListEvent} ev - Native reduced-motion change event from the explicitly owned media query.
   * @returns {void} Delivers the native matches value to the borrowed listener.
   */
  const onChange = (ev: MediaQueryListEvent) => listener(ev.matches);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
