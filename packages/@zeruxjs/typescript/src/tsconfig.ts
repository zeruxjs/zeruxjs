import fs from 'node:fs';
import path from 'node:path';

export interface TsConfigOptions { overwrite?: boolean; compilerOptions?: Record<string, unknown>; include?: string[]; exclude?: string[] }
/** Generates a safe default tsconfig only if none exists, unless overwrite is explicit. */
export function createTsConfig(rootDir: string, options: TsConfigOptions = {}): string {
  const root = path.resolve(rootDir);
  fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, 'tsconfig.json');
  if (fs.existsSync(file) && !options.overwrite) return file;
  const config = {
    compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
      strict: true, skipLibCheck: true, esModuleInterop: true,
      forceConsistentCasingInFileNames: true,
      ...options.compilerOptions
    },
    include: options.include ?? ['src/**/*.ts', 'src/**/*.tsx'],
    exclude: options.exclude ?? ['node_modules', 'dist', 'build']
  };
  const temp = path.join(root, `.tsconfig-${process.pid}-${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    try { fs.unlinkSync(temp); } catch (err) { if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err; }
  }
  return file;
}
