const { getFolders, getSafeName, writeState, readState } = require('./helper');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const dirsToScan = [
    path.join(__dirname, '../apps'),
    path.join(__dirname, '../packages')
];
const folders = getFolders(dirsToScan, 'dev', true);

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
        console.log('Ensuring Docker container is running...');
        execSync('docker-compose up -d', { stdio: 'inherit' });
    } catch (e) {
        console.log('Failed to start Docker container or docker-compose not available.');
    }
}

let appPortCounter = 3000;
let devPortCounter = 9999;

folders.forEach(({ dir, pkgName }) => {
    // Avoid double-starting if process tracking already knows about this directory 
    // (relevant if restarting partially)
    if (processes.find(p => p.dir === dir)) return;

    const safeName = getSafeName(pkgName);

    // Assign ports: 2 servers -> 2 ports (e.g. App at 3000+, Dev Tools/HMR at 9999+)
    const appPort = appPortCounter++;
    const devPort = devPortCounter++;

    console.log(`Starting detached 'npm run dev' for ${pkgName}... (Assigned Ports: ${appPort}, ${devPort})`);

    // Naming logs safely per package
    const out = fs.openSync(path.join(dir, `${safeName}-dev-out.log`), 'a');
    const err = fs.openSync(path.join(dir, `${safeName}-dev-err.log`), 'a');

    const child = spawn('npm', ['run', 'dev'], {
        cwd: dir,
        detached: true,
        stdio: ['ignore', out, err],
        // Pass the ports as environment variables
        env: { ...process.env, PORT: appPort, DEV_PORT: devPort }
    });

    processes.push({ name: pkgName, safeName, dir, pid: child.pid, ports: [appPort, devPort] });
    child.unref();
    console.log(`Dev process started (PID: ${child.pid}) for ${pkgName}`);
});

writeState({ type: 'dev', processes });
console.log('All dev scripts executed in the background.');
