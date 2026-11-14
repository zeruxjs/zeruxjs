/**
 * Preserve the legacy locale-folded Unicode letter/number tokenizer.
 * @param {string} text - Untrusted source/prompt text; never executed as instructions.
 * @returns {string[]} Matched word tokens; no regex is constructed from query input.
 */
export function tokenize(text: string): string[] {
  return text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}
