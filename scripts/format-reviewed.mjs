import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

// Only reviewed scopes are enforced during migration. The explicit argument
// array keeps paths out of a shell; no package source is imported or executed.
const root = new URL('../', import.meta.url);
const { completed, deferred = [] } = JSON.parse(
  await readFile(new URL('quality-scopes.json', root), 'utf8')
);
for (const scope of [...completed, ...deferred]) {
  if (
    !/^(?:packages|apps|sample-packages)\/(?:@?[a-z0-9-]+\/)*[a-z0-9-]+$/.test(
      scope
    )
  ) {
    throw new Error('Invalid reviewed quality scope');
  }
}
if (completed.length === 0) {
  console.log('No package scopes reviewed yet; see notes/sprint.md.');
} else {
  const require = createRequire(import.meta.url);
  const result = spawnSync(
    process.execPath,
    [
      require.resolve('prettier/bin/prettier.cjs'),
      '--config',
      'prettier.config.mjs',
      '--ignore-path',
      '.prettierignore',
      '--check',
      ...completed,
      ...deferred.map((scope) => `!${scope}/**`),
    ],
    { cwd: root, stdio: 'inherit' }
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
