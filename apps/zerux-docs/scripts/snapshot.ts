import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from '../src/lib/content.ts';
import { site } from '../src/site.config.ts';
import { workspaceReference } from '../src/lib/reference.ts';

/** Explicit CLI version; freezing references is never a build side effect. */
const id = process.argv[2];
/** Only a configured live workspace version may be frozen. */
const version = site.versions.find((item) => item.id === id);
if (!version || version.reference !== 'workspace') {
  throw new Error('Choose a configured workspace-backed version to freeze');
}
/** Public manifest/README snapshot; no package implementation is executed. */
const packages = await workspaceReference();
if (packages.find((item) => item.name === 'zeruxjs')?.version !== id) {
  throw new Error('Snapshot before bumping workspace package versions');
}
/** Version-local snapshot uses exclusive creation so archives cannot be silently overwritten. */
const target = path.join(root, 'src/docs', id, 'reference.snapshot.json');
await fs.writeFile(
  target,
  JSON.stringify({ schema: 1, version: id, packages }, null, 2) + '\n',
  { flag: 'wx' }
);
console.info(
  `[docs] Frozen references for ${id}. Commit the snapshot, set reference: 'snapshot' and pin the Git source ref before adding the next version.`
);
