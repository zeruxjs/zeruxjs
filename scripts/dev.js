/** Local value for destructured values. */
const { resetLogFileSync } = require('./file-io.cjs');
/** Local value for destructured values. */
const { getSafeName, writeState, readState, stopProcess } = require('./helper');
/** Local value for path. */
const path = require('path');
/** Local value for fs. */
const fs = require('fs');
/** Local value for destructured values. */
const { spawn } = require('child_process');

if (process.argv.includes('--run-packages-watcher')) {
  /** Local value for watcher module path. */
  const watcherModulePath = path.join(
    __dirname,
    '../packages/zlook/dist/index.js'
  );
  if (!fs.existsSync(watcherModulePath)) {
    console.error('Watcher module not found. Build zlook first.');
    process.exit(1);
  }

  let debounceTimer = null;

  import('file://' + watcherModulePath)
    .then(({ startWatcher }) => {
      /** Local value for pkgs path. */
      const pkgsPath = path.join(__dirname, '../packages');
      startWatcher(pkgsPath, (event, eventType) => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
          console.log(
            `\n[Watcher] Package changed: ${event.file}, restarting apps...`
          );

          /** Local value for current state. */
          const currentState = readState();
          if (
            !currentState ||
            currentState.type !== 'dev' ||
            !currentState.processes
          ) {
            return;
          }

          /** Local value for app procs. */
          const appProcs = currentState.processes.filter((p) =>
            /[\\/]apps[\\/][^\\/]+$/.test(p.dir)
          );
          /** Local value for other procs. */
          const otherProcs = currentState.processes.filter(
            (p) => !/[\\/]apps[\\/][^\\/]+$/.test(p.dir)
          );

          /** Local value for new app procs. */
          const newAppProcs = [];

          appProcs.forEach((proc) => {
            console.log(`Restarting ${proc.name}...`);
            stopProcess(proc);

            /** Local value for out path. */
            const outPath = path.join(proc.dir, `${proc.safeName}-dev-out.log`);
            /** Local value for err path. */
            const errPath = path.join(proc.dir, `${proc.safeName}-dev-err.log`);

            /** Local value for out. */
            const out = resetLogFileSync(outPath);
            /** Local value for err. */
            const err = resetLogFileSync(errPath);

            /** Local value for child. */
            const child = spawn('npm', ['run', 'dev'], {
              cwd: proc.dir,
              detached: true,
              stdio: ['ignore', out, err],
              env: { ...process.env },
            });

            newAppProcs.push({ ...proc, pid: child.pid, ports: proc.ports });
            child.unref();
          });

          writeState({
            type: 'dev',
            processes: [...otherProcs, ...newAppProcs],
          });
          console.log('[Watcher] Apps restarted.');
        }, 1000);
      });
    })
    .catch((err) => {
      console.error('Failed to start watcher:', err);
    });

  /** Local value for keep alive. */
  const keepAlive = setInterval(() => {}, 10000);
  process.once('exit', () => clearInterval(keepAlive));
  return;
}

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

/** Perform the scan packages operation.
 * @param {unknown} dir - Input value for dir.
 * @returns {unknown} Result produced by scan packages.
 */
function scanPackages(dir) {
  /** Local value for packages. */
  const packages = [];
  if (!fs.existsSync(dir)) {
    return packages;
  }

  /** Local value for entries level1. */
  const entriesLevel1 = fs.readdirSync(dir, { withFileTypes: true });
  for (const lvl1 of entriesLevel1) {
    if (
      !lvl1.isDirectory() ||
      lvl1.name.startsWith('.') ||
      lvl1.name === 'node_modules'
    ) {
      continue;
    }
    /** Local value for path1. */
    const path1 = path.join(dir, lvl1.name);

    if (lvl1.name.startsWith('@')) {
      /** Local value for entries level2. */
      const entriesLevel2 = fs.readdirSync(path1, { withFileTypes: true });
      for (const lvl2 of entriesLevel2) {
        if (
          !lvl2.isDirectory() ||
          lvl2.name.startsWith('.') ||
          lvl2.name === 'node_modules'
        ) {
          continue;
        }
        /** Local value for path2. */
        const path2 = path.join(path1, lvl2.name);
        /** Local value for pkg path2. */
        const pkgPath2 = path.join(path2, 'package.json');

        if (fs.existsSync(pkgPath2)) {
          addIfValid(pkgPath2, path2);
        } else {
          /** Local value for entries level3. */
          const entriesLevel3 = fs.readdirSync(path2, { withFileTypes: true });
          for (const lvl3 of entriesLevel3) {
            if (
              !lvl3.isDirectory() ||
              lvl3.name.startsWith('.') ||
              lvl3.name === 'node_modules'
            ) {
              continue;
            }
            /** Local value for path3. */
            const path3 = path.join(path2, lvl3.name);
            /** Local value for pkg path3. */
            const pkgPath3 = path.join(path3, 'package.json');
            if (fs.existsSync(pkgPath3)) {
              addIfValid(pkgPath3, path3);
            }
          }
        }
      }
    } else {
      /** Local value for pkg path1. */
      const pkgPath1 = path.join(path1, 'package.json');
      if (fs.existsSync(pkgPath1)) {
        addIfValid(pkgPath1, path1);
      }
    }
  }

  /** Perform the add if valid operation.
   * @param {unknown} pkgPath - Input value for pkg path.
   * @param {unknown} fullPath - Input value for full path.
   * @returns {unknown} Result produced by add if valid.
   */
  function addIfValid(pkgPath, fullPath) {
    try {
      /** Local value for pkg. */
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.scripts && pkg.scripts.dev) {
        packages.push({
          dir: fullPath,
          pkgName: pkg.name || path.basename(fullPath),
        });
      }
    } catch (e) {
      /* Best-effort cleanup/discovery may already be unavailable; the owning operation handles its outcome. */
    }
  }

  return packages;
}

/** Local value for apps path. */
const appsPath = path.join(__dirname, '../apps');
/** Local value for pkgs path. */
const pkgsPath = path.join(__dirname, '../packages');

/** Local value for apps. */
const apps = scanApps(appsPath);
/** Local value for packages. */
const packages = scanPackages(pkgsPath);

/** Local value for folders. */
const folders = [...apps, ...packages];

if (folders.length === 0) {
  console.log('No non-private folders with dev scripts found.');
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
  if (processes.find((p) => p.dir === dir)) {
    return;
  }

  /** Local value for safe name. */
  const safeName = getSafeName(pkgName);

  console.log(`Starting detached 'npm run dev' for ${pkgName}...`);

  /** Local value for out path. */
  const outPath = path.join(dir, `${safeName}-dev-out.log`);
  /** Local value for err path. */
  const errPath = path.join(dir, `${safeName}-dev-err.log`);

  // Reset logs

  /** Local value for out. */
  const out = resetLogFileSync(outPath);
  /** Local value for err. */
  const err = resetLogFileSync(errPath);

  /** Local value for child. */
  const child = spawn('npm', ['run', 'dev'], {
    cwd: dir,
    detached: true,
    stdio: ['ignore', out, err],
    env: { ...process.env }, // Pass clean env, servers handle fallback
  });

  processes.push({ name: pkgName, safeName, dir, pid: child.pid, ports: [] });
  child.unref();
});

// Spawn packages watcher
if (packages.length > 0 && apps.length > 0) {
  console.log('Starting `zlook` for packages...');
  /** Local value for watcher child. */
  const watcherChild = spawn('node', [__filename, '--run-packages-watcher'], {
    cwd: __dirname,
    detached: true,
    stdio: 'ignore',
  });
  processes.push({
    name: 'packages-watcher',
    safeName: 'packages-watcher',
    dir: __dirname,
    pid: watcherChild.pid,
    ports: [],
  });
  watcherChild.unref();
}

let pendingApps = apps.length;

if (pendingApps === 0) {
  writeState({ type: 'dev', processes });
  console.log('All dev scripts executed in the background.');
  process.exit(0);
}

console.log('Waiting up to 15s to detect allocated server ports...');
/** Local value for check interval. */
const checkInterval = setInterval(() => {
  let allReady = true;

  for (const proc of processes) {
    if (!/[\\/]apps[\\/][^\\/]+$/.test(proc.dir)) {
      continue;
    }

    let foundApp = proc.foundAppPort;
    let foundDev = proc.foundDevPort;

    if (!foundApp || !foundDev) {
      /** Local value for out path. */
      const outPath = path.join(proc.dir, `${proc.safeName}-dev-out.log`);
      if (fs.existsSync(outPath)) {
        /** Local value for content. */
        const content = fs.readFileSync(outPath, 'utf8');

        if (!foundApp) {
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
            foundApp = true;
            console.log(
              `[${proc.name}] App Server started on ${appMatch[1].toLowerCase()} port ${appMatch[2]}`
            );
          }
        }

        if (!foundDev) {
          /** Local value for dev match. */
          const devMatch = content.match(
            /Dev Server is running at (https?):\/\/localhost:(\d+)/i
          );
          if (devMatch) {
            proc.ports.push({
              port: parseInt(devMatch[2], 10),
              protocol: devMatch[1].toLowerCase(),
            });
            proc.foundDevPort = true;
            foundDev = true;
            console.log(
              `[${proc.name}] Dev Server started on ${devMatch[1].toLowerCase()} port ${devMatch[2]}`
            );
          }
        }

        /** Local value for busy match. */
        const busyMatch = content.match(/Port (\d+) is already in use/i);
        if (busyMatch && (!foundApp || !foundDev)) {
          proc.ports.push({
            port: parseInt(busyMatch[1], 10),
            protocol: 'http',
          });
          proc.foundAppPort = true;
          proc.foundDevPort = true;
          foundApp = true;
          foundDev = true;
          console.log(`[${proc.name}] Port ${busyMatch[1]} is already in use`);
        }
      }
    }

    if (!foundApp || !foundDev) {
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
    delete p.foundDevPort;
  });

  writeState({ type: 'dev', processes });
  console.log('All dev scripts securely executed and state saved.');
  process.exit(0);
}
