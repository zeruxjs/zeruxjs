#!/usr/bin/env node

import { startDev } from "../commands/dev.js";
import { startServer } from "../commands/start.js";
import { buildProject } from "../commands/build.js";
import { cli } from "@zeruxjs/cli";

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

        case "lint":
        case "lint:watch":
        case "lint:fix":
        case "lint:watch:fix":
        case "lint:js":
        case "lint:js:watch":
        case "lint:js:fix":
        case "lint:js:watch:fix":
        case "lint:css":
        case "lint:css:watch":
        case "lint:css:fix":
        case "lint:css:watch:fix":
        case "lint:all":
        case "lint:all:watch":
        case "lint:all:fix":
        case "lint:all:watch:fix": {
            const lint = await import("@zeruxjs/lint");

            const fix = command.includes(":fix");
            const watch = command.includes(":watch");

            let runner;

            if (command.includes(":js")) {
                runner = () => lint.lintJs({ fix });
            } else if (command.includes(":css")) {
                runner = () => lint.lintCss({ fix });
            } else if (command.includes(":all")) {
                runner = () => lint.lintAll({ fix });
            } else {
                runner = () => lint.lint({ fix });
            }

            if (watch) {
                await lint.watch(runner);
            } else {
                await runner();
            }

            break;
        }

        default:
            console.log(`
ZeruxJS CLI

Commands:
  zerux dev
  zerux start
  zerux build
  zerux lint
`);
    }
}

// run();

cli.addCommand('zerux', 'apple', () => { console.log('called apple 2') })