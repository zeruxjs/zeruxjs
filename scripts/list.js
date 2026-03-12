const { readState } = require('./helper');
const path = require('path');

const state = readState();

console.log('Currently running tracked processes:\n');

if (state && state.processes && state.processes.length > 0) {
    const tableData = {};
    let sNo = 1;

    state.processes.forEach(p => {
        const isApp = /[\\\/]apps[\\\/][^\\\/]+$/.test(p.dir);
        const pkgType = isApp ? 'App' : 'Package';

        // For Packages or specific watchers, print directly
        if (!isApp) {
            tableData[sNo++] = {
                'Package Name': p.name,
                'Package Type': pkgType,
                'Type (If App)': '-',
                'Running': '-',
                'PID': p.pid,
                'Directory Path': p.dir
            };
            return;
        }

        // For Apps, handle ports appropriately
        if (!p.ports || p.ports.length === 0) {
            tableData[sNo++] = {
                'Package Name': p.name,
                'Package Type': pkgType,
                'Type (If App)': 'App',
                'Running': '-',
                'PID': p.pid,
                'Directory Path': p.dir
            };
            return;
        }

        // Generate independent rows for allocated ports
        p.ports.forEach((portInfo, index) => {
            const port = typeof portInfo === 'object' ? portInfo.port : portInfo;
            const protocol = typeof portInfo === 'object' ? portInfo.protocol : 'http';
            
            let rowType = 'App';
            let mappedRun = `${protocol}://localhost:${port}`;

            if (index === 0) {
                rowType = 'App';
            } else {
                rowType = 'Dev Tools';
            }

            tableData[sNo++] = {
                'Package Name': p.name,
                'Package Type': pkgType,
                'Type (If App)': rowType,
                'Running': mappedRun,
                'PID': p.pid,
                'Directory Path': p.dir
            };

            if (index === 1) { // Dev Tools also usually have a secondary WS mapping in dev
                const wsProto = protocol === 'https' ? 'wss' : 'ws';
                tableData[sNo++] = {
                    'Package Name': p.name,
                    'Package Type': pkgType,
                    'Type (If App)': 'Dev Tools WS',
                    'Running': `${wsProto}://localhost:${port}`,
                    'PID': p.pid,
                    'Directory Path': p.dir
                };
            }
        });
    });

    console.table(tableData);
    console.log(`\nCurrently running in mode: ${state.type.toUpperCase()}`);
} else {
    console.log('No processes are currently active or tracked.');
}
