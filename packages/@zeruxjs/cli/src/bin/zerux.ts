#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { createRequire } from "module";
import cli from "../index.js";

const require = createRequire(import.meta.url);

function findNodeModules(start: string): string | null {
    let dir = start;

    while (dir !== path.parse(dir).root) {
        const nm = path.join(dir, "node_modules");

        if (fs.existsSync(nm)) {
            return nm;
        }

        dir = path.dirname(dir);
    }

    return null;
}

function loadPlugins() {
    const nodeModules = findNodeModules(process.cwd());

    if (!nodeModules) {
        return;
    }

    const packages = fs.readdirSync(nodeModules);

    for (const pkg of packages) {
        if (pkg.startsWith(".")) continue;

        let pkgPath = path.join(nodeModules, pkg);

        if (pkg.startsWith("@")) {
            const scopePackages = fs.readdirSync(pkgPath);

            for (const scoped of scopePackages) {
                loadPackage(path.join(pkgPath, scoped));
            }

            continue;
        }

        loadPackage(pkgPath);
    }
}

function loadPackage(pkgPath: string) {
    try {
        const pkgJsonPath = path.join(pkgPath, "package.json");

        if (!fs.existsSync(pkgJsonPath)) {
            return;
        }

        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));

        if (!pkg.zerux) {
            return;
        }

        const entry = path.join(pkgPath, pkg.zerux);

        require(entry);
    } catch {
        // ignore plugin errors
    }
}

async function main() {
    cli.addKey("zerux");

    loadPlugins();

    const [, , command, ...args] = process.argv;

    if (!command) {
        console.log("Zerux CLI");
        process.exit(0);
    }

    await cli.run("zerux", command, args);
}

main();