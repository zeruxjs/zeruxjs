import type { I18n, Translator } from './types.js';
/** Minimal structural signal contract; no Zyro runtime dependency is imported. */
export interface RevisionSignal {
  /** Revision read tracked by the host signal runtime; no DOM or runtime is imported here. */
  value: number;
}
/** Bind translator reads to a host-owned Zyro-compatible signal.
 * @param {I18n} i18n - Borrowed application catalog/locale owner.
 * @param {(initial: number) => RevisionSignal} signal - Trusted host signal factory from the owning renderer.
 * @returns {Translator & {dispose(): void}} Owned subscription view; borrowed i18n and native runtime remain host-owned.
 */
export function createZyroI18n(
  i18n: I18n,
  signal: (initial: number) => RevisionSignal
): Translator & { dispose(): void } {
  /** Owned revision holder created through the explicit host factory. */
  const revision = signal(0);
  let disposed = false;
  /** This adapter owns only its change registration, never the translator itself. */
  const stop = i18n.subscribe(() => {
    revision.value++;
  });
  /** Track the host revision and reject use after local teardown.
   * @returns {void} Performs no translation, loading or DOM work itself.
   */
  const read = () => {
    if (disposed) {
      throw new Error('zlocale: reactive translator disposed');
    }
    void revision.value;
  };
  return Object.freeze<Translator & { dispose(): void }>({
    getLocale() {
      read();
      return i18n.getLocale();
    },
    __(text, domain) {
      read();
      return i18n.__(text, domain);
    },
    _x(text, context, domain) {
      read();
      return i18n._x(text, context, domain);
    },
    _n(single, plural, count, domain) {
      read();
      return i18n._n(single, plural, count, domain);
    },
    _nx(single, plural, count, context, domain) {
      read();
      return i18n._nx(single, plural, count, context, domain);
    },
    hasTranslation(text, context, domain) {
      read();
      return i18n.hasTranslation(text, context, domain);
    },
    isRTL() {
      read();
      return i18n.isRTL();
    },
    formatNumber(value, options) {
      read();
      return i18n.formatNumber(value, options);
    },
    formatDateTime(value, options) {
      read();
      return i18n.formatDateTime(value, options);
    },
    formatRelativeTime(value, unit, options) {
      read();
      return i18n.formatRelativeTime(value, unit, options);
    },
    formatList(values, options) {
      read();
      return i18n.formatList(values, options);
    },
    /** Detach this subscription without destroying borrowed catalogs or renderer state.
     * @returns {void} Idempotently stops forwarding; later reads throw. */
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      stop();
    },
  });
}
