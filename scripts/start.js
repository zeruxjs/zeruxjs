const { getFolders, getSafeName, readState, writeState } = require('./helper');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const dirsToScan = [path.join(__dirname, '../apps')];
const folders = getFolders(dirsToScan, 'start', false);

if (folders.length === 0) {
    console.log('No folders with start scripts found in /apps.');
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

let portCounter = 3000;

folders.forEach(({ dir, pkgName }) => {
    // Avoid double-starting
    if (processes.find(p => p.dir === dir)) return;

    const safeName = getSafeName(pkgName);
    
    // Assign 1 port to a start script
    const assignedPort = portCounter++;

    console.log(`Starting detached 'npm run start' for ${pkgName}... (Assigned Port: ${assignedPort})`);
    
    // Naming logs safely per package
    const out = fs.openSync(path.join(dir, `${safeName}-start-out.log`), 'a');
    const err = fs.openSync(path.join(dir, `${safeName}-start-err.log`), 'a');
    
    const child = spawn('npm', ['run', 'start'], {
        cwd: dir,
        detached: true,
        stdio: ['ignore', out, err],
        // Pass the port as an environment variable
        env: { ...process.env, PORT: assignedPort }
    });
    
    processes.push({ name: pkgName, safeName, dir, pid: child.pid, ports: [assignedPort] });
    child.unref();
    console.log(`Start process started (PID: ${child.pid}) for ${pkgName}`);
});

writeState({ type: 'start', processes });
console.log('All start scripts executed in the background.');
