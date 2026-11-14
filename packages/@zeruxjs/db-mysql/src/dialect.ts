import type { SqlDialectDefinition } from '@zeruxjs/db-sql-core';
/** MySQL-only SQL-core translation: parameterized values, quoted identifiers and explicit unsupported RETURNING/index guards. */
export const mysqlDialect: SqlDialectDefinition = {
  kind: 'mysql',
  /** Quote an already validated identifier using native backtick escaping.
   * @param {string} identifier - Identifier checked by the shared SQL compiler.
   * @returns {string} Escaped native identifier, never a bound value.
   */
  quoteIdentifier: (identifier: string) =>
    `\`${identifier.replace(/`/g, '``')}\``,
  /** Use native parameter placeholders rather than interpolating values.
   * @returns {string} One MySQL parameter marker.
   */
  placeholder: () => '?',
  functions: {
    LEN: 'CHAR_LENGTH',
    NOW: 'NOW',
    CURRENT_TIMESTAMP: 'CURRENT_TIMESTAMP',
    CURRENT_DATE: 'CURRENT_DATE',
    DATE_DIFF: 'DATEDIFF',
  },
  supportsReturning: false,
  supportsIfNotExistsIndex: false,
  autoIncrementKeyword: 'AUTO_INCREMENT',
};
