import type { ShareData } from './types.js';
import { normalizedShareData } from './url.js';
export interface ShareEnvironment {
  /** Optional borrowed native-like sharing function, invoked only by an explicit user action. */
  share?: (data: ShareData) => Promise<void>;
  /** Optional borrowed clipboard function; fallback policy is separate from permission. */
  writeText?: (text: string) => Promise<void>;
  /** Legacy compatible optional callback; this controller never invokes it automatically. */
  open?: (url: string) => void;
}
/** Create an inert controller over trusted injected browser capabilities, usable in SSR without reading navigator. Owns no listener/timer and exposes no disposer.
 * @param {ShareEnvironment} environment - Borrowed trusted native-like functions; no platform or popup is invoked during construction.
 * @param {{
    copyFallback?: boolean;
    onResult?: (result: 'shared' | 'copied' | 'unavailable') => void;
  }} options - Optional explicit copy-fallback and synchronous result callback policy.
 * @param {boolean} options.copyFallback - Allow fallback unless explicitly false.
 * @param {(result: 'shared' | 'copied' | 'unavailable') => void} options.onResult - Optional trusted synchronous observer; native outcomes are not rolled back by callback failure.
 * @returns {object} Inert capability getter and explicitly invoked share method; host callbacks retain their own failures/ownership.
 */
export function createShareController(
  environment: ShareEnvironment,
  options: {
    /** Allow unsupported/denied sharing to copy unless explicitly false. */
    copyFallback?: boolean;
    /** Optional trusted synchronous observation callback; it is not a durable delivery acknowledgement. */
    onResult?: (result: 'shared' | 'copied' | 'unavailable') => void;
  } = {}
) {
  return {
    /** Inspect callable borrowed capabilities without invoking the platform.
     * @returns {{native: boolean, clipboard: boolean}} Feature flags, not platform permission or delivery proof.
     */
    get capabilities() {
      return {
        native: typeof environment.share === 'function',
        clipboard: typeof environment.writeText === 'function',
      };
    },
    /** Try injected native sharing, preserving AbortError cancellation. Only unsupported/denied native paths may use the explicitly allowed clipboard fallback; never auto-open a popup.
     * @param {ShareData} data - Trusted authored fields; URL normalizes before native work.
     * @returns {Promise<'shared' | 'copied' | 'unavailable'>} Explicit share/copy/unavailable outcome; unexpected native or host callback failure is not fabricated success.
     */
    async share(data: ShareData): Promise<'shared' | 'copied' | 'unavailable'> {
      /** Independent normalized share fields; native APIs receive only an explicitly initiated payload. */
      const normalized = normalizedShareData(data);
      // AbortError is a deliberate user cancellation: never open a popup or copy unexpectedly.
      if (environment.share) {
        try {
          await environment.share(normalized);
          options.onResult?.('shared');
          return 'shared';
        } catch (error) {
          if ((error as { name?: string })?.name === 'AbortError') {
            throw error;
          }
          if (
            (error as { name?: string })?.name !== 'NotAllowedError' &&
            (error as { name?: string })?.name !== 'NotSupportedError'
          ) {
            throw error;
          }
        }
      }
      if (options.copyFallback !== false && environment.writeText) {
        await environment.writeText(normalized.url);
        options.onResult?.('copied');
        return 'copied';
      }
      options.onResult?.('unavailable');
      return 'unavailable';
    },
  };
}
