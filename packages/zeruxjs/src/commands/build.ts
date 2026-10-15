import path from 'node:path';
import { loadConfig } from '../bootstrap/config.js';
import { buildProjectSources } from './project-builder.js';

/** Compile application routes, controllers, plugins and public files for production. */
export async function buildProject(rootDir = process.cwd()) {
  const absoluteRoot = path.resolve(rootDir);
  const config = await loadConfig(absoluteRoot, 'start');
  const manifest = await buildProjectSources({ rootDir: absoluteRoot, config });
  console.info(`[zerux build] Compiled ${manifest.files} project files (${manifest.bytes} source bytes)`);
  return manifest;
}
