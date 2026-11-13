/** Local value for destructured values. */
const { resetLogFileSync } = require('./file-io.cjs');
/** Local value for destructured values. */
const { getSafeName, readState, writeState } = require('./helper');
/** Local value for path. */
const path = require('path');
/** Local value for fs. */
const fs = require('fs');
/** Local value for destructured values. */
const { spawn } = require('child_process');

/** Perform the scan apps operation.
 * @param {unknown} dir - Input value for dir.
 * @returns {unknown} Result produced by scan apps.
 */
function scanApps(dir) {
  /** Local value for apps. */
  const apps = [];
  if (!fs.existsSync(dir)) {
    return apps;
  }
  /** Local value for entries. */
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.name.startsWith('.') ||
      entry.name === 'node_modules'
    ) {
      continue;
    }
    /** Local value for app path. */
    const appPath = path.join(dir, entry.name);
    /** Local value for pkg path. */
    const pkgPath = path.join(appPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        /** Local value for pkg. */
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.scripts && pkg.scripts.start && pkg.scripts.dev) {
          apps.push({ dir: appPath, pkgName: pkg.name || entry.name });
        }
      } catch (e) {
        /* Best-effort cleanup/discovery may already be unavailable; the owning operation handles its outcome. */
      }
    }
  }
  return apps;
}

/** Local value for dirs to scan. */
const dirsToScan = path.join(__dirname, '../apps');
/** Local value for folders. */
const folders = scanApps(dirsToScan);

if (folders.length === 0) {
  console.log('No folders with start and dev scripts found in /apps.');
  process.exit(0);
}

/** Local value for current state. */
const currentState = readState();

if (currentState.processes && currentState.processes.length > 0) {
  console.error(
    `Environment is already running in '${currentState.type}' mode.`
  );
  console.error(
    'Please run "npm run env:stop" first to stop the current processes.'
  );
  process.exit(1);
}

/** Local value for processes. */
const processes = [];

// Ensure Docker container is running
if (!fs.existsSync('/.dockerenv')) {
  /** Local value for destructured values. */
  const { execSync } = require('child_process');
  try {
    /** Local value for running services. */
    const runningServices = execSync(
      'docker compose ps --services --filter "status=running"',
      { encoding: 'utf8' }
    ).trim();
    if (!runningServices) {
      console.log('Docker container is not running. Starting it...');
      execSync('docker compose up -d', { stdio: 'inherit' });
    } else {
      console.log('Docker container is already running.');
    }
  } catch (e) {
    console.log('Failed to check or start Docker container.');
  }
}

folders.forEach(({ dir, pkgName }) => {
  // Avoid double-starting
  if (processes.find((p) => p.dir === dir)) {
    return;
  }

  /** Local value for safe name. */
  const safeName = getSafeName(pkgName);

  console.log(`Starting detached 'npm run start' for ${pkgName}...`);

  /** Local value for out path. */
  const outPath = path.join(dir, `${safeName}-start-out.log`);
  /** Local value for err path. */
  const errPath = path.join(dir, `${safeName}-start-err.log`);

  // Reset logs

  /** Local value for out. */
  const out = resetLogFileSync(outPath);
  /** Local value for err. */
  const err = resetLogFileSync(errPath);

  /** Local value for child. */
  const child = spawn('npm', ['run', 'start'], {
    cwd: dir,
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env }, // Pass clean env, servers handle fallback
  });

  processes.push({ name: pkgName, safeName, dir, pid: child.pid, ports: [] });
  child.unref();
});

let pendingApps = folders.length;

if (pendingApps === 0) {
  writeState({ type: 'start', processes });
  console.log('All start scripts executed in the background.');
  process.exit(0);
}

console.log('Waiting up to 15s to detect allocated server ports...');
/** Local value for check interval. */
const checkInterval = setInterval(() => {
  let allReady = true;

  for (const proc of processes) {
    if (proc.foundAppPort) {
      continue;
    }

    /** Local value for out path. */
    const outPath = path.join(proc.dir, `${proc.safeName}-start-out.log`);
    if (fs.existsSync(outPath)) {
      /** Local value for content. */
      const content = fs.readFileSync(outPath, 'utf8');

      /** Local value for app match. */
      const appMatch = content.match(
        /App Server is running at (https?):\/\/localhost:(\d+)/i
      );
      if (appMatch) {
        proc.ports.push({
          port: parseInt(appMatch[2], 10),
          protocol: appMatch[1].toLowerCase(),
        });
        proc.foundAppPort = true;
        console.log(
          `[${proc.name}] App Server started on ${appMatch[1].toLowerCase()} port ${appMatch[2]}`
        );
      }

      /** Local value for busy match. */
      const busyMatch = content.match(/Port (\d+) is already in use/i);
      if (busyMatch && !proc.foundAppPort) {
        proc.ports.push({ port: parseInt(busyMatch[1], 10), protocol: 'http' });
        proc.foundAppPort = true;
        console.log(`[${proc.name}] Port ${busyMatch[1]} is already in use`);
      }
    }

    if (!proc.foundAppPort) {
      allReady = false;
    }
  }

  if (allReady) {
    cleanupAndExit();
  }
}, 500);

/** Local value for timeout. */
const timeout = setTimeout(() => {
  console.log('\nWait timeout reached. Some ports may not have been detected.');
  cleanupAndExit();
}, 15000);

/** Perform the cleanup and exit operation.
 * @returns {unknown} Result produced by cleanup and exit.
 */
function cleanupAndExit() {
  clearInterval(checkInterval);
  clearTimeout(timeout);

  processes.forEach((p) => {
    delete p.foundAppPort;
  });

  writeState({ type: 'start', processes });
  console.log('All start scripts securely executed and state saved.');
  process.exit(0);
}
