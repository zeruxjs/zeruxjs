import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Exact runtime exceptions; a reason is not permission to ignore unrelated paths. */
interface RetainedGroup {
  /** Owning runtime category. */
  kind: string;
  /** Source-backed reason this format remains required. */
  reason: string;
  /** Exact repository-relative paths; patterns are deliberately unsupported. */
  paths: string[];
}

/** Compare existing source paths with explicit runtime exceptions.
 * @param {readonly string[]} paths - Existing repository source paths, not imported modules.
 * @param {readonly RetainedGroup[]} retained - Reviewed exact runtime exceptions.
 * @returns {{unexpected: string[], stale: string[]}} Unmigrated code and obsolete exceptions.
 */
export function inspectMigration(
  paths: readonly string[],
  retained: readonly RetainedGroup[]
): { unexpected: string[]; stale: string[] } {
  /** Exact exception membership; duplicate paths would make ownership ambiguous. */
  const exceptions = new Set<string>();
  for (const group of retained) {
    if (!group.kind || !group.reason || !Array.isArray(group.paths)) {
      throw new Error('Invalid source migration policy');
    }
    for (const file of group.paths) {
      if (
        exceptions.has(file) ||
        file.includes('..') ||
        file.startsWith('/') ||
        /[*?]/.test(file)
      ) {
        throw new Error('Invalid or duplicate source migration exception');
      }
      exceptions.add(file);
    }
  }
  /** Existing JavaScript sources only; deleted tracked paths are filtered by the caller. */
  const javascript = new Set(
    paths.filter((file) => /\.(?:mjs|cjs|js)$/.test(file))
  );
  return {
    unexpected: [...javascript].filter((file) => !exceptions.has(file)).sort(),
    stale: [...exceptions]
      .filter(
        (file) =>
          !javascript.has(file) &&
          !retained.some(
            (group) => group.kind === 'generated' && group.paths.includes(file)
          )
      )
      .sort(),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  /** Repository anchor does not depend on the invoking directory. */
  const root = fileURLToPath(new URL('../', import.meta.url));
  /** Policy is JSON data; no source configuration is executed during this inventory. */
  const policy = JSON.parse(
    readFileSync(path.join(root, 'source-migration-policy.json'), 'utf8')
  ) as { retained: RetainedGroup[] };
  /** Git supplies authored tracked/untracked paths while excluding installations and ignored state. */
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' }
  )
    .split('\0')
    .filter((file) => file && existsSync(path.join(root, file)));
  /** Exact current inventory; test filenames get no retained-runtime exemption. */
  const report = inspectMigration(files, policy.retained);
  console.log(JSON.stringify(report, null, 2));
  if (report.unexpected.length || report.stale.length) {
    process.exitCode = 1;
  }
}
