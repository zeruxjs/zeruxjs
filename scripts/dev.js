const { getSafeName, writeState, readState, stopProcess } = require('./helper');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

if (process.argv.includes('--run-packages-watcher')) {
    const watcherModulePath = path.join(__dirname, '../packages/@zeruxjs/watcher/dist/index.js');
    if (!fs.existsSync(watcherModulePath)) {
        console.error('Watcher module not found. Build @zeruxjs/watcher first.');
        process.exit(1);
    }

    let debounceTimer = null;

    import('file://' + watcherModulePath).then(({ startWatcher }) => {
        const pkgsPath = path.join(__dirname, '../packages');
        startWatcher(pkgsPath, (event, eventType) => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                console.log(`\n[Watcher] Package changed: ${event.file}, restarting apps...`);

                const currentState = readState();
                if (!currentState || currentState.type !== 'dev' || !currentState.processes) return;

                const appProcs = currentState.processes.filter(p => /[\\\/]apps[\\\/][^\\\/]+$/.test(p.dir));
                const otherProcs = currentState.processes.filter(p => !/[\\\/]apps[\\\/][^\\\/]+$/.test(p.dir));

                const newAppProcs = [];

                appProcs.forEach(proc => {
                    console.log(`Restarting ${proc.name}...`);
                    stopProcess(proc);

                    const outPath = path.join(proc.dir, `${proc.safeName}-dev-out.log`);
                    const errPath = path.join(proc.dir, `${proc.safeName}-dev-err.log`);

                    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
                    if (fs.existsSync(errPath)) fs.unlinkSync(errPath);

                    const out = fs.openSync(outPath, 'a');
                    const err = fs.openSync(errPath, 'a');

                    const child = spawn('npm', ['run', 'dev'], {
                        cwd: proc.dir,
                        detached: true,
                        stdio: ['ignore', out, err],
                        env: { ...process.env }
                    });

                    newAppProcs.push({ ...proc, pid: child.pid, ports: proc.ports });
                    child.unref();
                });

                writeState({ type: 'dev', processes: [...otherProcs, ...newAppProcs] });
                console.log('[Watcher] Apps restarted.');

            }, 1000);
        });
    }).catch(err => {
        console.error('Failed to start watcher:', err);
    });

    setInterval(() => { }, 10000);
    return;
}

function scanApps(dir) {
    const apps = [];
    if (!fs.existsSync(dir)) return apps;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const appPath = path.join(dir, entry.name);
        const pkgPath = path.join(appPath, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                if (pkg.scripts && pkg.scripts.start && pkg.scripts.dev) {
                    apps.push({ dir: appPath, pkgName: pkg.name || entry.name });
                }
            } catch (e) { }
        }
    }
    return apps;
}

function scanPackages(dir) {
    const packages = [];
    if (!fs.existsSync(dir)) return packages;

    const entriesLevel1 = fs.readdirSync(dir, { withFileTypes: true });
    for (const lvl1 of entriesLevel1) {
        if (!lvl1.isDirectory() || lvl1.name.startsWith('.') || lvl1.name === 'node_modules') continue;
        const path1 = path.join(dir, lvl1.name);

        if (lvl1.name.startsWith('@')) {
            const entriesLevel2 = fs.readdirSync(path1, { withFileTypes: true });
            for (const lvl2 of entriesLevel2) {
                if (!lvl2.isDirectory() || lvl2.name.startsWith('.') || lvl2.name === 'node_modules') continue;
                const path2 = path.join(path1, lvl2.name);
                const pkgPath2 = path.join(path2, 'package.json');

                if (fs.existsSync(pkgPath2)) {
                    addIfValid(pkgPath2, path2);
                } else {
                    const entriesLevel3 = fs.readdirSync(path2, { withFileTypes: true });
                    for (const lvl3 of entriesLevel3) {
                        if (!lvl3.isDirectory() || lvl3.name.startsWith('.') || lvl3.name === 'node_modules') continue;
                        const path3 = path.join(path2, lvl3.name);
                        const pkgPath3 = path.join(path3, 'package.json');
                        if (fs.existsSync(pkgPath3)) {
                            addIfValid(pkgPath3, path3);
                        }
                    }
                }
            }
        } else {
            const pkgPath1 = path.join(path1, 'package.json');
            if (fs.existsSync(pkgPath1)) {
                addIfValid(pkgPath1, path1);
            }
        }
    }

    function addIfValid(pkgPath, fullPath) {
        try {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.scripts && pkg.scripts.dev) {
                packages.push({ dir: fullPath, pkgName: pkg.name || path.basename(fullPath) });
            }
        } catch (e) { }
    }

    return packages;
}

const appsPath = path.join(__dirname, '../apps');
const pkgsPath = path.join(__dirname, '../packages');

const apps = scanApps(appsPath);
const packages = scanPackages(pkgsPath);

const folders = [...apps, ...packages];

if (folders.length === 0) {
    console.log('No non-private folders with dev scripts found.');
    process.exit(0);
}

const currentState = readState();

if (currentState.processes && currentState.processes.length > 0) {
    console.error(`Environment is already running in '${currentState.type}' mode.`);
    console.error('Please run "npm run env:stop" first to stop the current processes.');
    process.exit(1);
}

const processes = [];

// Ensure Docker container is running
if (!fs.existsSync('/.dockerenv')) {
    const { execSync } = require('child_process');
    try {
        const runningServices = execSync('docker compose ps --services --filter "status=running"', { encoding: 'utf8' }).trim();
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
    if (processes.find(p => p.dir === dir)) return;

    const safeName = getSafeName(pkgName);

    console.log(`Starting detached 'npm run dev' for ${pkgName}...`);

    const outPath = path.join(dir, `${safeName}-dev-out.log`);
    const errPath = path.join(dir, `${safeName}-dev-err.log`);

    // Reset logs
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    if (fs.existsSync(errPath)) fs.unlinkSync(errPath);

    const out = fs.openSync(outPath, 'a');
    const err = fs.openSync(errPath, 'a');

    const child = spawn('npm', ['run', 'dev'], {
        cwd: dir,
        detached: true,
        stdio: ['ignore', out, err],
        env: { ...process.env } // Pass clean env, servers handle fallback
    });

    processes.push({ name: pkgName, safeName, dir, pid: child.pid, ports: [] });
    child.unref();
});

// Spawn packages watcher
if (packages.length > 0 && apps.length > 0) {
    console.log('Starting `@zeruxjs/watcher` for packages...');
    const watcherChild = spawn('node', [__filename, '--run-packages-watcher'], {
        cwd: __dirname,
        detached: true,
        stdio: 'ignore'
    });
    processes.push({ name: 'packages-watcher', safeName: 'packages-watcher', dir: __dirname, pid: watcherChild.pid, ports: [] });
    watcherChild.unref();
}

let pendingApps = apps.length;

if (pendingApps === 0) {
    writeState({ type: 'dev', processes });
    console.log('All dev scripts executed in the background.');
    process.exit(0);
}

console.log('Waiting up to 15s to detect allocated server ports...');
const checkInterval = setInterval(() => {
    let allReady = true;

    for (const proc of processes) {
        if (!/[\\\/]apps[\\\/][^\\\/]+$/.test(proc.dir)) continue;

        let foundApp = proc.foundAppPort;
        let foundDev = proc.foundDevPort;

        if (!foundApp || !foundDev) {
            const outPath = path.join(proc.dir, `${proc.safeName}-dev-out.log`);
            if (fs.existsSync(outPath)) {
                const content = fs.readFileSync(outPath, 'utf8');

                if (!foundApp) {
                    const appMatch = content.match(/App Server is running at (https?):\/\/localhost:(\d+)/i);
                    if (appMatch) {
                        proc.ports.push({ port: parseInt(appMatch[2], 10), protocol: appMatch[1].toLowerCase() });
                        proc.foundAppPort = true;
                        foundApp = true;
                        console.log(`[${proc.name}] App Server started on ${appMatch[1].toLowerCase()} port ${appMatch[2]}`);
                    }
                }

                if (!foundDev) {
                    const devMatch = content.match(/Dev Server is running at (https?):\/\/localhost:(\d+)/i);
                    if (devMatch) {
                        proc.ports.push({ port: parseInt(devMatch[2], 10), protocol: devMatch[1].toLowerCase() });
                        proc.foundDevPort = true;
                        foundDev = true;
                        console.log(`[${proc.name}] Dev Server started on ${devMatch[1].toLowerCase()} port ${devMatch[2]}`);
                    }
                }

                const busyMatch = content.match(/Port (\d+) is already in use/i);
                if (busyMatch && (!foundApp || !foundDev)) {
                    proc.ports.push({ port: parseInt(busyMatch[1], 10), protocol: 'http' });
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

    if (allReady) cleanupAndExit();
}, 500);

const timeout = setTimeout(() => {
    console.log('\nWait timeout reached. Some ports may not have been detected.');
    cleanupAndExit();
}, 15000);

function cleanupAndExit() {
    clearInterval(checkInterval);
    clearTimeout(timeout);

    processes.forEach(p => {
        delete p.foundAppPort;
        delete p.foundDevPort;
    });

    writeState({ type: 'dev', processes });
    console.log('All dev scripts securely executed and state saved.');
    process.exit(0);
}
