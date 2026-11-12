/** Shared source formatting; semantic linting remains in the owning engines. */
export default {
  semi: true,
  singleQuote: true,
  tabWidth: 2,
  trailingComma: 'es5',
  printWidth: 80,
  endOfLine: 'lf',
  // Keep authored prose and whitespace-sensitive templates semantically stable.
  proseWrap: 'preserve',
  htmlWhitespaceSensitivity: 'css',
  embeddedLanguageFormatting: 'off',
};
