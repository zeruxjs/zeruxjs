import path from 'node:path';
import { loadConfig } from '../bootstrap/config.js';
import { buildProjectSources } from './project-builder.js';

/** Load project configuration and delegate production compilation to the shared builder without starting an application.
 * @param {string} rootDir - Explicit project directory, default the caller working directory.
 * @returns {Promise<Awaited<ReturnType<typeof buildProjectSources>>>} Builder manifest after successful completion; failures propagate.
 */
export async function buildProject(rootDir = process.cwd()) {
  /** Canonical absolute host project path used for configuration and source compilation. */
  const absoluteRoot = path.resolve(rootDir);
  /** Private start-mode build configuration loaded from the selected project. */
  const config = await loadConfig(absoluteRoot, 'start');
  /** Completed project build receipt; compilation and staging remain builder-owned. */
  const manifest = await buildProjectSources({ rootDir: absoluteRoot, config });
  console.info(
    `[zerux build] Compiled ${manifest.files} project files (${manifest.bytes} source bytes)`
  );
  return manifest;
}
