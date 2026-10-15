const { getSafeName, readState, writeState } = require('./helper');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

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
            } catch (e) {}
        }
    }
    return apps;
}

const dirsToScan = path.join(__dirname, '../apps');
const folders = scanApps(dirsToScan);

if (folders.length === 0) {
    console.log('No folders with start and dev scripts found in /apps.');
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
    // Avoid double-starting
    if (processes.find(p => p.dir === dir)) return;

    const safeName = getSafeName(pkgName);
    
    console.log(`Starting detached 'npm run start' for ${pkgName}...`);
    
    const outPath = path.join(dir, `${safeName}-start-out.log`);
    const errPath = path.join(dir, `${safeName}-start-err.log`);

    // Reset logs
    if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    if (fs.existsSync(errPath)) fs.unlinkSync(errPath);
    
    const out = fs.openSync(outPath, 'a');
    const err = fs.openSync(errPath, 'a');
    
    const child = spawn('npm', ['run', 'start'], {
        cwd: dir,
        detached: true,
        stdio: ['ignore', out, err],
        env: { ...process.env } // Pass clean env, servers handle fallback
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
const checkInterval = setInterval(() => {
    let allReady = true;

    for (const proc of processes) {
        if (proc.foundAppPort) continue;

        const outPath = path.join(proc.dir, `${proc.safeName}-start-out.log`);
        if (fs.existsSync(outPath)) {
            const content = fs.readFileSync(outPath, 'utf8');
            
            const appMatch = content.match(/App Server is running at (https?):\/\/localhost:(\d+)/i);
            if (appMatch) {
                proc.ports.push({ port: parseInt(appMatch[2], 10), protocol: appMatch[1].toLowerCase() });
                proc.foundAppPort = true;
                console.log(`[${proc.name}] App Server started on ${appMatch[1].toLowerCase()} port ${appMatch[2]}`);
            }

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
    });

    writeState({ type: 'start', processes });
    console.log('All start scripts securely executed and state saved.');
    process.exit(0);
}
