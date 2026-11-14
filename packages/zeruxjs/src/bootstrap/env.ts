import { readLocalFileSync } from '../utils/file-content.js';

/** Parse one literal key/value line without shell expansion or JavaScript evaluation.
 * @param {string} line - Trusted environment-file line.
 * @returns {{key: string, value: string} | null} Parsed pair or null for ignored text.
 */
const parseEnvLine = (line: string) => {
  /** Whitespace-trimmed line; blank/comments are ignored before splitting. */
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  /** First equals sign; later equals signs remain part of the literal value. */
  const separatorIndex = trimmed.indexOf('=');
  if (separatorIndex === -1) {
    return null;
  }

  /** Explicit left-hand environment name; no variable interpolation is performed. */
  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  value = value.replace(/\\n/g, '\n');
  return { key, value };
};

/** Load bounded explicitly selected host files while preserving pre-existing process values.
 * @param {string[]} envFiles - Ordered trusted candidate paths.
 * @returns {string[]} Files successfully processed, never their credential contents.
 */
export const loadEnvironmentFiles = (envFiles: string[]) => {
  /** Processed filename list only; values are not logged or returned. */
  const loadedFiles: string[] = [];

  for (const envFile of envFiles) {
    let content: string;
    try {
      content = readLocalFileSync(envFile, 1024 * 1024, true).toString('utf8');
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code === 'ENOENT' ||
        (error as NodeJS.ErrnoException).code === 'EISDIR' ||
        (error as NodeJS.ErrnoException).code === 'EFTYPE'
      ) {
        continue;
      }
      throw error;
    }
    for (const line of content.split(/\r?\n/)) {
      /** Literal key/value pair; first-defined process value takes precedence. */
      const parsed = parseEnvLine(line);
      if (!parsed) {
        continue;
      }

      if (process.env[parsed.key] === undefined) {
        process.env[parsed.key] = parsed.value;
      }
    }

    loadedFiles.push(envFile);
  }

  return loadedFiles;
};
