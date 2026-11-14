/** Explicit adapter: accepts existing Playwright page, no runtime dependency. */
export interface PageLike {
  /** Navigate only an explicitly borrowed host page; destination/network policy belongs to its test owner.
   * @param {string} url - Host-authorized navigation URL.
   * @param {object} options - Optional trusted native navigation options.
   * @returns {Promise<unknown>} Actual borrowed page navigation outcome; no browser is acquired here.
   */
  goto(url: string, options?: object): Promise<unknown>;
  /** Obtain an explicit borrowed native selector handle; this helper executes no JavaScript source string.
   * @param {string} selector - Trusted test-authored selector.
   * @returns {{ count(): Promise<number>; click(options?: object): Promise<unknown> }} Borrowed native locator with host-owned lifetime.
   */
  locator(selector: string): {
    /** Count actual matching elements on the explicitly borrowed page.
     * @returns {Promise<number>} Actual native locator count, not fabricated DOM coverage.
     */
    count(): Promise<number>;
    /** Click a real matched element through a borrowed page or locator; no browser/page is owned or closed by this helper.
     * @param {object} options - Optional trusted native locator action policy.
     * @returns {Promise<unknown>} Actual native action outcome; selector and destination permissions remain host-owned.
     */
    click(options?: object): Promise<unknown>;
  };
}
/** Navigate an explicitly borrowed page only to an HTTP(S) URL; the test owner separately allowlists any external destination.
 * @param {PageLike} page - Borrowed host-owned page, never closed by this helper.
 * @param {string} url - Explicit host-authorized HTTP(S) navigation target.
 * @returns {Promise<void>} Actual native navigation settlement; no application is started automatically.
 */
export async function visit(page: PageLike, url: string) {
  if (!/^https?:\/\//.test(url)) {
    throw new TypeError('Expected http(s) URL');
  }
  await page.goto(url);
}
/** Click a real matched element through a borrowed page or locator; no browser/page is owned or closed by this helper.
 * @param {PageLike} page - Borrowed host-provided page.
 * @param {string} selector - Trusted test-authored selector.
 * @returns {Promise<void>} Resolves after the native click settles; selector and destination permissions remain host-owned.
 */
export async function click(page: PageLike, selector: string) {
  /** Borrowed native locator checked for actual existence before one explicit click. */
  const loc = page.locator(selector);
  if (!(await loc.count())) {
    throw new Error(`Element not found: ${selector}`);
  }
  await loc.click();
}
