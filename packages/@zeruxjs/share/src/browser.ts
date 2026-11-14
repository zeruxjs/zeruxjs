import type { ShareData, ShareCapabilities } from './types.js';
import { createShareController } from './controller.js';
import { normalizedShareData, validatedShareUrl } from './url.js';
/** Detect callable native sharing/clipboard functions without invoking them or assuming user permission.
 * @returns {ShareCapabilities} Current capability flags; missing navigator yields false values and no side effects.
 */
export function shareCapabilities(): ShareCapabilities {
  return {
    native:
      typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    clipboard:
      typeof navigator !== 'undefined' &&
      typeof navigator.clipboard?.writeText === 'function',
  };
}
/** Explicitly invoke native Web Share only when available. Host UI owns user gesture/permissions; native errors including user cancellation propagate.
 * @param {ShareData} data - Trusted authored fields with validated HTTP(S) URL.
 * @returns {Promise<boolean>} False when native sharing is unavailable; true after native completion, not proof of recipient delivery.
 */
export async function share(data: ShareData): Promise<boolean> {
  /** Validated sharing field copy prepared before interacting with a native platform. */
  const normalized = normalizedShareData(data);
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.share !== 'function'
  ) {
    return false;
  }
  await navigator.share(normalized);
  return true;
}
/** Explicitly copy one validated sharing URL through a callable native clipboard API; no server/global fallback is installed.
 * @param {string} url - Host-selected absolute credential-free HTTP(S) content URL.
 * @returns {Promise<void>} Native clipboard settlement; unavailable/denied platform access rejects.
 */
export async function copyShareUrl(url: string): Promise<void> {
  /** Normalized sharing URL checked before any clipboard interaction. */
  const valid = validatedShareUrl(url);
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.clipboard?.writeText !== 'function'
  ) {
    throw new Error('Clipboard API unavailable');
  }
  await navigator.clipboard.writeText(valid);
}
/** Explicitly copy authored text through the native clipboard API. No HTML/code evaluation or automatic browser action occurs.
 * @param {string} text - Trusted authored clipboard text; native platform limits/permissions remain authoritative.
 * @returns {Promise<void>} Native clipboard settlement; unavailable/denied access rejects.
 */
export async function copyShareText(text: string): Promise<void> {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.clipboard?.writeText !== 'function'
  ) {
    throw new Error('Clipboard API unavailable');
  }
  await navigator.clipboard.writeText(text);
}
/** Feature-detect borrowed native functions and apply the explicit controller fallback policy. User AbortError never triggers an unexpected copy or popup.
 * @param {ShareData} data - Trusted authored share fields with a validated URL.
 * @returns {Promise<'shared' | 'copied' | 'unavailable'>} Explicit native/fallback outcome; unexpected native errors propagate.
 */
export async function shareOrCopy(
  data: ShareData
): Promise<'shared' | 'copied' | 'unavailable'> {
  /** Feature-detected borrowed native capabilities; absent/noncallable properties are not invoked. */
  const environment =
    typeof navigator === 'undefined'
      ? {}
      : {
          share:
            typeof navigator.share === 'function'
              ? (input: ShareData) => navigator.share(input)
              : undefined,
          writeText:
            typeof navigator.clipboard?.writeText === 'function'
              ? (text: string) => navigator.clipboard.writeText(text)
              : undefined,
        };
  return createShareController(environment).share(data);
}
