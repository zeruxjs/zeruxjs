const { readState, writeState, stopProcess } = require('./helper');
const { execSync } = require('child_process');

// Optional target name to stop specific process, e.g. "npm run env:stop core"
const args = process.argv.slice(2);
const isHard = args.includes('--hard');
const targetName = args.find(a => !a.startsWith('--'));
const state = readState();
let stoppedCount = 0;

if (state && state.processes) {
    if (targetName) {
        // Stop a specific process only
        state.processes = state.processes.filter(p => {
            if (p.name === targetName || p.safeName === targetName) {
                if (stopProcess(p)) {
                    console.log(`Stopped process ${p.name} (PID: ${p.pid})`);
                    stoppedCount++;
                } else {
                    console.log(`Failed to stop process ${p.name} (PID: ${p.pid})`);
                }
                return false; // Remove from tracking file
            }
            return true; // Keep others
        });
        writeState(state);
    } else {
        // Stop all processes
        state.processes.forEach(p => {
            if (stopProcess(p)) {
                console.log(`Stopped process ${p.name} (PID: ${p.pid})`);
                stoppedCount++;
            }
        });
        writeState({ type: null, processes: [] });
    }
}

// Global cleanup ONLY if no precision targetName was specified
if (!targetName) {
    console.log('Executing broader fallback cleanup...');
    try {
        execSync("pkill -f 'npm run dev' || true");
        execSync("pkill -f 'npm run start' || true");
        execSync("pkill -f 'npm start' || true");
    } catch (e) {}

    const fs = require('fs');
    if (!fs.existsSync('/.dockerenv') && isHard) {
        console.log('Stopping Docker container (--hard flag passed)...');
        try {
            execSync('docker compose down', { stdio: 'inherit' });
        } catch (e) {
            console.log('Failed to stop Docker container.');
        }
    }
}

console.log(`Environment stopped. Tracked processes terminated: ${stoppedCount}`);
