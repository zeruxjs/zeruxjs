#!/usr/bin/env node

import { startDev } from "../commands/dev";
import { startServer } from "../commands/start";
import { buildProject } from "../commands/build";

const command = process.argv[2];

async function run() {
    switch (command) {
        case "dev":
            await startDev();
            break;

        case "start":
            await startServer();
            break;

        case "build":
            await buildProject();
            break;

        default:
            console.log(`
ZeruxJS CLI

Commands:
  zerux dev
  zerux start
  zerux build
`);
    }
}

run();