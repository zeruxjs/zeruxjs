import fs from 'node:fs/promises';
import path from 'node:path';
import { root } from '../src/lib/content.mjs';
import { site } from '../src/site.config.mjs';
import { workspaceReference } from '../src/lib/reference.mjs';

const id = process.argv[2];
const version = site.versions.find((item) => item.id === id);
if (!version || version.reference !== 'workspace')
  throw new Error('Choose a configured workspace-backed version to freeze');
const packages = await workspaceReference();
if (packages.find((item) => item.name === 'zeruxjs')?.version !== id)
  throw new Error('Snapshot before bumping workspace package versions');
const target = path.join(root, 'src/docs', id, 'reference.snapshot.json');
await fs.writeFile(
  target,
  JSON.stringify({ schema: 1, version: id, packages }, null, 2) + '\n',
  { flag: 'wx' },
);
console.info(
  `[docs] Frozen references for ${id}. Commit the snapshot, set reference: 'snapshot' and pin the Git source ref before adding the next version.`,
);
