const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '../.dev-container/.env-state.json');

function getFolders(dirsToScan, scriptName, ignorePrivate = false) {
    const targets = [];

    const scan = (dir, depth = 1) => {
        if (!fs.existsSync(dir) || depth > 4) return;
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;

                const fullPath = path.join(dir, entry.name);
                const pkgPath = path.join(fullPath, 'package.json');

                if (fs.existsSync(pkgPath)) {
                    try {
                        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                        if (ignorePrivate && pkg.private === true) {
                            // Skip private
                        } else if (!scriptName || (pkg.scripts && pkg.scripts[scriptName])) {
                            targets.push({
                                dir: fullPath,
                                pkgName: pkg.name || entry.name
                            });
                        }
                    } catch (e) { }
                } else {
                    scan(fullPath, depth + 1);
                }
            }
        }
    }

    dirsToScan.forEach(dir => scan(dir));
    return targets;
}

function getSafeName(pkgName) {
    // Replace '/' and '@' with '-' and remove leading dashes
    return pkgName.replace(/[@\/]/g, '-').replace(/^-+/, '');
}

function readState() {
    if (fs.existsSync(STATE_FILE)) {
        try {
            return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
        } catch (e) { }
    }
    return { type: null, processes: [] };
}

function writeState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function stopProcess(processInfo) {
    try {
        process.kill(-processInfo.pid, 'SIGKILL');
        return true;
    } catch (e) {
        try {
            process.kill(processInfo.pid, 'SIGKILL');
            return true;
        } catch (err) {
            return false;
        }
    }
}

module.exports = {
    getFolders,
    getSafeName,
    readState,
    writeState,
    stopProcess,
    STATE_FILE
};
