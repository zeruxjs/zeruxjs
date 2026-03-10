const { readState } = require('./helper');
const { execSync } = require('child_process');
const path = require('path');

const state = readState();
const previousType = state ? state.type : null;

console.log('Executing stop script...');
try {
    execSync('node ' + path.join(__dirname, 'stop.js'), { stdio: 'inherit' });
} catch (e) {
    console.error('Stop script execution failed:', e.message);
}

if (previousType === 'start') {
    console.log('\nRestarting start processes...');
    execSync('node ' + path.join(__dirname, 'start.js'), { stdio: 'inherit' });
} else if (previousType === 'dev') {
    console.log('\nRestarting dev processes...');
    execSync('node ' + path.join(__dirname, 'dev.js'), { stdio: 'inherit' });
} else {
    console.log('\nNo previous state available to determine mode. Run dev.js or start.js explicitly first.');
}
