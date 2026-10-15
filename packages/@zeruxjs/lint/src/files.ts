import fs from 'node:fs';
import path from 'node:path';
const extensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx', '.json', '.jsonc', '.css', '.scss', '.html', '.vue', '.md', '.yaml', '.yml']);
const ignored = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt', '.output', '.cache', '.turbo']);
/** Resolve explicit files or enumerate supported source files, never following symlinks. */
export function discoverLintFiles(cwd: string, options: { files?: string[]; maxFiles?: number } = {}): string[] {
  const base = path.resolve(cwd);
  const max = options.maxFiles ?? 10_000;
  if (!Number.isSafeInteger(max) || max < 1 || max > 100_000) throw new Error('Invalid maxFiles');
  const found: string[] = [];
  const check = (name: string) => {
    if (found.length >= max) throw new Error(`Lint file count exceeds ${max}`);
    if (extensions.has(path.extname(name).toLowerCase())) found.push(name);
  };
  const visit = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.isSymbolicLink()) continue;
      const location = path.join(dir, item.name);
      if (item.isDirectory()) { if (!ignored.has(item.name) && !item.name.startsWith('.')) visit(location); }
      else if (item.isFile()) check(location);
    }
  };
  if (options.files?.length) {
    for (const file of options.files) {
      const location = path.resolve(base, file);
      if (location !== base && !location.startsWith(base + path.sep)) throw new Error('Lint file escapes project root');
      const stat = fs.lstatSync(location);
      if (stat.isSymbolicLink()) throw new Error('Symlink lint input is not allowed');
      if (stat.isDirectory()) visit(location);
      else if (stat.isFile()) check(location);
    }
  } else visit(base);
  return [...new Set(found)].sort();
}
