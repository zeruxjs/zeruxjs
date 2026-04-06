const { readState } = require('./helper');
const { execSync, execFileSync } = require('child_process');
const path = require('path');

const state = readState();
const previousType = state ? state.type : null;

console.log('Executing stop script...');
try {
    execFileSync('node', [path.join(__dirname, 'stop.js')], { stdio: 'inherit' });
} catch (e) {
    console.error('Stop script execution failed:', e.message);
}

if (previousType === 'start') {
    console.log('\nRestarting start processes...');
    try {
        execFileSync('node', [path.join(__dirname, 'start.js')], { stdio: 'inherit' });
    } catch (e) {
        console.error('Start script execution failed:', e.message);
    }
} else if (previousType === 'dev') {
    console.log('\nRestarting dev processes...');
    try {
        execFileSync('node', [path.join(__dirname, 'dev.js')], { stdio: 'inherit' });
    } catch (e) {
        console.error('Dev script execution failed:', e.message);
    }
} else {
    console.log('\nNo previous state available to determine mode. Run dev.js or start.js explicitly first.');
}
