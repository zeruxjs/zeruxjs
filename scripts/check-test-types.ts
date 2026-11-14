import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkTypes, type TypecheckResult } from '@zeruxjs/typescript';

/** Compiler-owned message data; this tool does not evaluate test modules. */
type Message = TypecheckResult['diagnostics'][number]['messageText'];

/** Flatten compiler message chains without dropping nested explanations.
 * @param {Message} message - Structured TypeScript diagnostic message.
 * @returns {string} Human-readable local diagnostic; never sent to an external service.
 */
function messageText(message: Message): string {
  if (typeof message === 'string') {
    return message;
  }
  return [message.messageText, ...(message.next ?? []).map(messageText)].join(
    '\n'
  );
}

/** Repository anchor is independent of the caller's working directory. */
const root = fileURLToPath(new URL('../', import.meta.url));
/** Optional exact source subtree; flags never become shell code or module imports. */
const args = process.argv.slice(2);
if (
  args.length !== 0 &&
  (args.length !== 2 ||
    args[0] !== '--scope' ||
    !/^(?:packages|apps|sample-packages|scripts|tests|\.github)(?:\/[a-zA-Z0-9@_.-]+)*$/.test(
      args[1]
    ) ||
    args[1].split('/').includes('..'))
) {
  throw new Error('Usage: check-test-types.ts [--scope repository/subtree]');
}
/** A scope restricts root test files; imported declarations/source are still checked. */
const scope = args[1];
/** Git excludes dependency installations and private/generated ignored state. */
const files = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { cwd: root, encoding: 'utf8' }
)
  .split('\0')
  .filter(
    (file) =>
      file.endsWith('.test.ts') &&
      existsSync(path.join(root, file)) &&
      (!scope || file === scope || file.startsWith(scope + '/'))
  );
if (!files.length) {
  throw new Error('No TypeScript tests found in the selected source scope');
}
/** Public shared tooling API forces noEmit; no test callback or application is executed. */
const result = checkTypes({
  cwd: root,
  configFile: 'tsconfig.tests.json',
  files,
});
for (const diagnostic of result.diagnostics) {
  /** Compiler location is displayed locally to make each error actionable. */
  const location =
    diagnostic.file && diagnostic.start !== undefined
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : undefined;
  console.error(
    `${diagnostic.file?.fileName ?? 'configuration'}${location ? `:${location.line + 1}:${location.character + 1}` : ''} TS${diagnostic.code}: ${messageText(diagnostic.messageText)}`
  );
}
console.log(
  `${files.length} test files; ${result.diagnostics.length} diagnostics; ${result.status}`
);
process.exitCode = result.ok ? 0 : 1;
