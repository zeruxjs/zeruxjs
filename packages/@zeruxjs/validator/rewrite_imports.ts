import fs from 'fs';
import path from 'path';

const srcDir = path.join(__dirname, 'src');
const fsDir = path.join(__dirname, 'fs');

function buildExportMapFromFs(dir, baseDir) {
    const exportsMap = new Map();
    // we want to map export symbol names to the new path in `src`
    // Wait, let's keep it simpler. We can parse the new `src/` files to build the map!
    return exportsMap;
}
