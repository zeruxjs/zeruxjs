import { register } from 'node:module';
import { setLoaderService } from './registry.js';

export interface LoaderOptions {
  /** Explicit local source root for CLI development/build; absent in production. */
  sourceRoot?: string;
}
/** Register the native process loader using an explicitly selected source root.
 * Registration is process-wide; this compatibility API has no unregister handle.
 * Native registration failures are reported to the console and not rethrown.
 * @param {string} serviceName - Host-selected compatibility service label.
 * @param {LoaderOptions} options - Optional trusted local source root.
 * @returns {void} Registration attempt completion, not a success receipt.
 */
export const registerLoader = (
  serviceName = 'zerux',
  options: LoaderOptions = {}
) => {
  setLoaderService(serviceName);

  // IMPORTANT: resolve relative to THIS FILE, not cwd
  /** Native loader module URL, always relative to this installed module. */
  const loaderUrl = new URL('./loader.js', import.meta.url);
  try {
    register(loaderUrl.href, {
      data: { serviceName, sourceRoot: options.sourceRoot },
    });
  } catch (err) {
    console.error('[zerux loader] Failed to register loader:', err);
  }
};
