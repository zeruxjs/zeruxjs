import fs from 'node:fs/promises';
import path from 'node:path';
import { discoverPackages, repositoryRoot, root } from './content.mjs';

/** Read a workspace reference snapshot without executing package code. @returns {Promise<object[]>} Public manifests and README text. Reads package metadata only. */
export async function workspaceReference() {
  const packages = await discoverPackages();
  return Promise.all(
    packages.map(async (item) => ({
      ...item,
      readme: await fs
        .readFile(path.join(repositoryRoot, item.source, 'README.md'), 'utf8')
        .catch((error) => {
          if (error.code !== 'ENOENT') throw error;
          return '';
        }),
    })),
  );
}
/** Load live or frozen package references for a docs version.
 * @param {object} version Version configuration. @returns {Promise<object[]>} Manifest snapshot. Reads workspace or an explicit version-local snapshot.
 */
export async function versionReference(version) {
  if (version.reference === 'snapshot') {
    const data = JSON.parse(
      await fs.readFile(
        path.join(root, 'src/docs', version.id, 'reference.snapshot.json'),
        'utf8',
      ),
    );
    if (
      data.schema !== 1 ||
      data.version !== version.id ||
      !Array.isArray(data.packages)
    )
      throw new Error(`Invalid reference snapshot for ${version.id}`);
    return data.packages;
  }
  if (version.reference !== 'workspace')
    throw new Error(
      `Select workspace or snapshot references for ${version.id}`,
    );
  const packages = await workspaceReference();
  const framework = packages.find((item) => item.name === 'zeruxjs');
  if (framework?.version !== version.id)
    throw new Error(
      `Framework ${framework?.version} differs from live docs ${version.id}; freeze references before changing the framework docs version`,
    );
  return packages;
}
