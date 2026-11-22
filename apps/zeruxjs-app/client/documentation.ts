'use client';
import { enhanceDocumentation } from '@zeruxjs/docs/browser';
/** One page/BFCache lifetime owns the optional controls; no application data is fetched. */
let view: ReturnType<typeof enhanceDocumentation> | undefined;
/** Enhance only this public docs shell; other application pages are untouched.
 * @returns {void} Native code-copy controls or a readable unenhanced document when unavailable.
 */
function mount(): void {
  /** Explicit docs scope excludes private workspace DOM and unrelated code blocks. */
  const root = document.querySelector<HTMLElement>('.zerux-docs-layout');
  if (root && !view) {
    view = enhanceDocumentation(root);
  }
}
mount();
window.addEventListener('pagehide', () => {
  view?.destroy();
  view = undefined;
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) {
    mount();
  }
});
