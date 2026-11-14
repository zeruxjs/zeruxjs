import { AssetManager } from './manager.js';
import type { AssetSnapshot } from './types.js';
import { readCatalogData, writeCatalogData } from './catalog-io.js';
/** Persist a private V1 snapshot through the bounded same-directory atomic writer.
 * @param {AssetManager} manager - Borrowed catalog whose current snapshot is copied.
 * @param {string} file - Private destination under a host-trusted directory.
 * @returns {Promise<void>} Settles after file sync/rename; host owns trusted directory and cross-process locking.
 */
export async function saveAssetCatalog(
  manager: AssetManager,
  file: string
): Promise<void> {
  await writeCatalogData(file, manager.snapshot());
}
/** Read bounded no-follow private JSON and validate it before exposing a new catalog.
 * @param {string} file - Private existing catalog under a trusted parent directory.
 * @returns {Promise<AssetManager>} New valid catalog; malformed/symlink/oversized files reject.
 */
export async function loadAssetCatalog(file: string): Promise<AssetManager> {
  /** New catalog populated only after bounded private file data passes snapshot validation. */
  const catalog = new AssetManager();
  catalog.load((await readCatalogData(file)) as AssetSnapshot);
  return catalog;
}
