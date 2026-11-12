/** Node build/watch boundary; core/browser imports never load filesystem or watcher code. */
export {
  createProjectScanner,
  scanProjectFiles,
  scanProject,
  buildZuix,
  buildZuixStylesheet,
} from './node-build.js';
export { watchZuix } from './watch.js';
export type { ZuixWatchOptions, ZuixWatchHandle } from './watch.js';
