#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseBuildOptions, runWorkspaceBuild } from './workspace-build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const options = parseBuildOptions(process.argv.slice(2));
  const result = await runWorkspaceBuild(root, options, {
    onEvent: event => { if (!options.json) console.log(`[workspaces] ${event.type}: ${event.name}`); }
  });
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`[workspaces] ${options.dryRun ? 'Planned' : 'Built'} ${result.planned.length} workspaces`);
} catch (error) {
  console.error(`[workspaces] ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
