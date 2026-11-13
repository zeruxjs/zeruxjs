import path from 'node:path';

import { ensureDirectory } from '../utils/fs.js';
import { writeRuntimeJson } from './persist.js';
import type { ZeruxRuntime } from './types.js';

/** Persist the runtime’s explicit diagnostic projection in its private output directory.
 * @param {ZeruxRuntime} runtime - Generation owning the projection.
 * @returns {string} Private manifest path after atomic metadata replacement.
 */
export const writeRuntimeManifest = (runtime: ZeruxRuntime) => {
  ensureDirectory(runtime.structure.outputDir);

  /** Explicit private runtime.json destination; it is not automatically a public endpoint. */
  const manifestPath = path.join(runtime.structure.outputDir, 'runtime.json');
  writeRuntimeJson(manifestPath, runtime.toManifest());

  return manifestPath;
};
