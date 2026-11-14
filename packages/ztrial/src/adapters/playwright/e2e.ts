import type { PageLike } from './page.js';
/** Execute an explicit trusted ordered step list against a caller-owned page without acquiring or closing browser resources.
 * @param {PageLike} page - Borrowed host-owned native-compatible page.
 * @param {readonly ((page: PageLike) => Promise<unknown>)[]} steps - Trusted callbacks, awaited in declaration order and never loaded from arbitrary strings.
 * @returns {Promise<void>} Actual sequential step settlement; each host step owns its own timeout/cancellation policy.
 */
export async function runE2E(
  page: PageLike,
  steps: readonly ((page: PageLike) => Promise<unknown>)[]
) {
  for (const step of steps) {
    await step(page);
  }
}
