/** Local value for destructured values. */
const { getFolders } = require('./helper');
/** Local value for path. */
const path = require('path');
/** Local value for destructured values. */
const { execSync } = require('child_process');

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
