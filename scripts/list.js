const { readState } = require('./helper');

const state = readState();

console.log('Currently running tracked processes:\n');

if (state && state.processes && state.processes.length > 0) {
    console.table(state.processes.map(p => ({
        'Package Name': p.name,
        'Assigned Ports': p.ports ? p.ports.join(', ') : 'Unknown',
        'PID': p.pid,
        'Directory Path': p.dir
    })));
    console.log(`\nCurrently running in mode: ${state.type.toUpperCase()}`);
} else {
    console.log('No processes are currently active or tracked.');
}
