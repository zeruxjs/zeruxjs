import { visuallyHiddenStyle } from './aria.js';
/** Create one owned text-only live region in the explicit document.
 * @param {Document} doc - Explicit owning document; default DOM globals are read only when this API is called.
 * @returns {{announce:(message:string,assertive?:boolean)=>void, clear:()=>void, destroy:()=>void}} Owned live-region handle; destroy removes its node and later announcements are ignored.
 */
export function createLiveAnnouncer(doc: Document = document) {
  /** Owned live-region element; all announcements use textContent rather than HTML. */
  const el = doc.createElement('div');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.setAttribute('role', 'status');
  Object.assign(el.style, visuallyHiddenStyle());
  doc.body.appendChild(el);
  let disposed = false;
  return {
    /** Write plain announcement text into this owned live region without HTML parsing.
     * @param {string} message - Caller-approved announcement text; never parsed as HTML.
     * @param {boolean} assertive - Use assertive/alert semantics when true; defaults to polite/status.
     * @returns {void} No value; writes text only while the owned live region is active.
     */
    announce(message: string, assertive = false) {
      if (disposed) {
        return;
      }
      el.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
      el.setAttribute('role', assertive ? 'alert' : 'status');
      el.textContent = '';
      el.textContent = message;
    },
    /** Clear only the current live region, ignoring calls after disposal.
     * @returns {void} No value; empties the active region without parsing or announcing HTML.
     */
    clear() {
      if (!disposed) {
        el.textContent = '';
      }
    },
    /** Release this owner resources; borrowed dependencies remain caller-owned.
     * @returns {void} No value; removes the owned node and ignores subsequent announce/clear calls.
     */
    destroy() {
      if (disposed) {
        return;
      }
      disposed = true;
      el.remove();
    },
  };
}
