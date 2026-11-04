import type { SearchAnalyzer } from './types.js';
export function normalizeAnalyzer(
  input: SearchAnalyzer = {},
): Required<Omit<SearchAnalyzer, 'locale'>> & { locale?: string } {
  if (
    !input ||
    Object.keys(input).some(
      (k) =>
        !['normalization', 'caseSensitive', 'locale', 'diacritics', 'includeMarks'].includes(k),
    ) ||
    (input.normalization !== undefined &&
      !['none', 'NFC', 'NFD', 'NFKC', 'NFKD'].includes(input.normalization)) ||
    (input.caseSensitive !== undefined && typeof input.caseSensitive !== 'boolean') ||
    (input.includeMarks !== undefined && typeof input.includeMarks !== 'boolean') ||
    (input.diacritics !== undefined && !['preserve', 'fold'].includes(input.diacritics)) ||
    (input.locale !== undefined && (typeof input.locale !== 'string' || input.locale.length > 64))
  )
    throw new TypeError('Invalid search analyzer');
  const locale =
    input.locale === undefined
      ? Intl.DateTimeFormat().resolvedOptions().locale
      : Intl.getCanonicalLocales(input.locale)[0];
  return {
    normalization: input.normalization ?? 'NFKC',
    caseSensitive: input.caseSensitive ?? false,
    diacritics: input.diacritics ?? 'preserve',
    includeMarks: input.includeMarks ?? false,
    ...(locale ? { locale } : {}),
  };
}
/** Defaults retain legacy NFKC/lowercase/letter-number tokenization. */
export function tokenize(value: string, options: SearchAnalyzer = {}): string[] {
  if (typeof value !== 'string' || value.length > 16 * 1024 * 1024)
    throw new RangeError('Invalid tokenizer input length');
  const a = normalizeAnalyzer(options);
  let text = a.normalization === 'none' ? value : value.normalize(a.normalization);
  if (!a.caseSensitive) text = text.toLocaleLowerCase(a.locale);
  if (a.diacritics === 'fold') text = text.normalize('NFD').replace(/\p{M}/gu, '');
  return text.match(a.includeMarks ? /[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu : /[\p{L}\p{N}]+/gu) ?? [];
}
