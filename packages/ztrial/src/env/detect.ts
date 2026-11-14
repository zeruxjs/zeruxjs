/** Inspect current ambient runtime availability without loading DOM/browser dependencies or starting a browser.
 * @returns {{ node: boolean; browser: boolean; dom: boolean }} Presence flags only; globals do not certify full browser feature support.
 */
export function environment() {
  return {
    node: typeof process !== 'undefined' && Boolean(process.versions?.node),
    browser: typeof window !== 'undefined',
    dom: typeof document !== 'undefined',
  };
}
