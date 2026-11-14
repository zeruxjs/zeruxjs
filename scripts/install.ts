import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFolders } from './helper.ts';

// Workspace discovery must remain relative to this script on every platform.
/** Absolute filename used to anchor workspace discovery. */
const __filename = fileURLToPath(import.meta.url);
/** Directory containing the install script. */
const __dirname = path.dirname(__filename);

/** Local value for dirs to scan. */
const dirsToScan = [
  path.join(__dirname, '../apps'),
  path.join(__dirname, '../packages'),
];

// No specific scriptName required for install, so we pass null for scriptName
/** Local value for folders. */
const folders = getFolders(dirsToScan, null, true);

if (folders.length === 0) {
  console.log('No folders with non-private packages found for install.');
  process.exit(0);
}

console.log(`Found ${folders.length} valid folders to install dependencies.`);

folders.forEach(({ dir, pkgName }) => {
  console.log(`\n-----------------------------------------`);
  console.log(`Running 'npm install' inside: ${pkgName} (${dir})`);
  console.log(`-----------------------------------------`);
  try {
    execSync('npm install', { cwd: dir, stdio: 'inherit' });
  } catch (e) {
    console.error(`Failed executing install in ${pkgName}`);
  }
});

console.log('\nAll installations complete.');
