const { readState } = require('./helper');
const { execFileSync } = require('child_process');
const path = require('path');

const state = readState();
const previousType = state ? state.type : null;

// Use the current process path to avoid PATH lookup issues
const nodePath = process.execPath;

console.log('Executing stop script...');
try {
    execFileSync(nodePath, [path.resolve(__dirname, 'stop.js')], { stdio: 'inherit' });
} catch (e) {
    console.error('Stop script execution failed:', e.message);
}

if (previousType === 'start') {
    console.log('\nRestarting start processes...');
    try {
        execFileSync(nodePath, [path.resolve(__dirname, 'start.js')], { stdio: 'inherit' });
    } catch (e) {
        console.error('Start script execution failed:', e.message);
    }
} else if (previousType === 'dev') {
    console.log('\nRestarting dev processes...');
    try {
        execFileSync(nodePath, [path.resolve(__dirname, 'dev.js')], { stdio: 'inherit' });
    } catch (e) {
        console.error('Dev script execution failed:', e.message);
    }
} else {
    console.log('\nNo previous state available to determine mode. Run dev.js or start.js explicitly first.');
}

