import type { I18n, Translator } from "./types.js";
/** Minimal structural signal contract; no Zyro runtime dependency is imported. */
export interface RevisionSignal {
  value: number;
}
/** Bind translator reads to a host-owned Zyro-compatible signal.
 * @param i18n Application-owned translator. @param signal Host signal factory.
 * @returns Reactive translator and disposer. Reads/writes only the supplied signal and i18n subscription.
 */
export function createZyroI18n(
  i18n: I18n,
  signal: (initial: number) => RevisionSignal,
): Translator & { dispose(): void } {
  const revision = signal(0);
  let disposed = false;
  const stop = i18n.subscribe(() => {
    revision.value++;
  });
  const read = () => {
    if (disposed) throw new Error("zlocale: reactive translator disposed");
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
    /** Detach reactive updates. @returns Nothing. Idempotent; later reads throw. No globals. */
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
    },
  });
}
