/** Require an already-present DOM global without loading an emulator or opening a browser.
 * @returns {Document} Borrowed ambient document; the host owns its lifetime.
 */
export function requireDom(): Document {
  if (typeof document === 'undefined') {
    throw new Error('DOM is unavailable: install jsdom or run in a browser');
  }
  return document;
}
/** Lazily load the explicitly installed optional jsdom package and create an owned synthetic document; defaults do not enable script execution or remote resource loading.
 * @param {string} html - Trusted synthetic fixture markup; this helper is not an HTML sanitizer.
 * @returns {Promise<{ window: Window & { close(): void }; document: Document; cleanup: () => void }>} Owned environment; invoke cleanup after the fixture and never replace unrelated process globals implicitly.
 */
export async function createJsdomEnvironment(
  html = '<!doctype html><html><body></body></html>'
) {
  /** Fixed optional jsdom module name; no dependency is loaded merely by importing this adapter. */
  const specifier = 'jsdom';
  /** Explicit optional module loaded only when the environment factory runs. */
  const mod = (await import(specifier)) as {
    JSDOM: new (
      html: string,
      options?: object
    ) => { window: Window & { close(): void } };
  };
  /** Owned synthetic DOM instance; cleanup closes only its native jsdom window. */
  const dom = new mod.JSDOM(html, { url: 'http://localhost/' });
  return {
    window: dom.window,
    document: dom.window.document,
    cleanup: () => dom.window.close(),
  };
}
