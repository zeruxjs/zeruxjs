/** Local value for fs. */
const fs = require('fs');
/** Local value for path. */
const path = require('path');

/** Local value for state file. */
const STATE_FILE = path.join(__dirname, '../.dev-container/.env-state.json');

/** Perform the get folders operation.
 * @param {unknown} dirsToScan - Input value for dirs to scan.
 * @param {unknown} scriptName - Input value for script name.
 * @param {unknown} ignorePrivate - Input value for ignore private.
 * @returns {unknown} Result produced by get folders.
 */
function getFolders(dirsToScan, scriptName, ignorePrivate = false) {
  /** Local value for targets. */
  const targets = [];

  /**
   * Run the scan callback.
   * @param {unknown} dir - Input value for dir.
   * @param {unknown} depth - Input value for depth.
   * @returns {unknown} Result produced by scan.
   */
  const scan = (dir, depth = 1) => {
    if (!fs.existsSync(dir) || depth > 4) {
      return;
    }
    /** Local value for entries. */
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue;
        }

        /** Local value for full path. */
        const fullPath = path.join(dir, entry.name);
        /** Local value for pkg path. */
        const pkgPath = path.join(fullPath, 'package.json');

        if (fs.existsSync(pkgPath)) {
          try {
            /** Local value for pkg. */
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (ignorePrivate && pkg.private === true) {
              // Skip private
            } else if (
              !scriptName ||
              (pkg.scripts && pkg.scripts[scriptName])
            ) {
              targets.push({
                dir: fullPath,
                pkgName: pkg.name || entry.name,
              });
            }
          } catch (e) {
            /* Best-effort cleanup/discovery may already be unavailable; the owning operation handles its outcome. */
          }
        } else {
          scan(fullPath, depth + 1);
        }
      }
    }
  };

  dirsToScan.forEach((dir) => scan(dir));
  return targets;
}

/** Perform the get safe name operation.
 * @param {unknown} pkgName - Input value for pkg name.
 * @returns {unknown} Result produced by get safe name.
 */
function getSafeName(pkgName) {
  // Replace '/' and '@' with '-' and remove leading dashes
  return pkgName.replace(/[@/]/g, '-').replace(/^-+/, '');
}

/** Perform the read state operation.
 * @returns {unknown} Result produced by read state.
 */
function readState() {
  if (fs.existsSync(STATE_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
      /* Best-effort cleanup/discovery may already be unavailable; the owning operation handles its outcome. */
    }
  }
  return { type: null, processes: [] };
}

/** Perform the write state operation.
 * @param {unknown} state - Input value for state.
 * @returns {unknown} Result produced by write state.
 */
function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

/** Perform the stop process operation.
 * @param {unknown} processInfo - Input value for process info.
 * @returns {unknown} Result produced by stop process.
 */
function stopProcess(processInfo) {
  try {
    process.kill(-processInfo.pid, 'SIGKILL');
    return true;
  } catch (e) {
    try {
      process.kill(processInfo.pid, 'SIGKILL');
      return true;
    } catch (err) {
      return false;
    }
  }
}

module.exports = {
  getFolders,
  getSafeName,
  readState,
  writeState,
  stopProcess,
  STATE_FILE,
};
