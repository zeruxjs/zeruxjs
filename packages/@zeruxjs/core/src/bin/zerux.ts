#!/usr/bin/env node

import "../loader/register-loader.js";
import { cli } from "@zeruxjs/cli";

// Core commands
import { startDev } from "../commands/dev.js";
import { startServer } from "../commands/start.js";
import { buildProject } from "../commands/build.js";

/**
 * Core Commands
 */
cli.addCommand(
    "zerux",
    "dev",
    async () => {
        await startDev();
    },
    {
        description: "Start development server",
        docs: "Runs the development server with hot reload support.",
        example: "npx zerux dev"
    }
);

cli.addCommand(
    "zerux",
    "start",
    async () => {
        await startServer();
    },
    {
        description: "Start production server",
        docs: "Runs the built application in production mode.",
        example: "npx zerux start"
    }
);

cli.addCommand(
    "zerux",
    "build",
    async () => {
        await buildProject();
    },
    {
        description: "Build the project",
        docs: "Compiles the project for production deployment.",
        example: "npx zerux build"
    }
);

/**
 * Lint Commands (auto-generated)
 */
const lintCommands = [
    "lint",
    "lint:watch",
    "lint:fix",
    "lint:watch:fix",
    "lint:js",
    "lint:js:watch",
    "lint:js:fix",
    "lint:js:watch:fix",
    "lint:css",
    "lint:css:watch",
    "lint:css:fix",
    "lint:css:watch:fix",
    "lint:all",
    "lint:all:watch",
    "lint:all:fix",
    "lint:all:watch:fix"
];

for (const command of lintCommands) {
    cli.addCommand(
        "zerux",
        command,
        async () => {
            const lint = await import("@zeruxjs/lint");

            const fix = command.includes(":fix");
            const watch = command.includes(":watch");

            let runner: () => Promise<void>;

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
        },
        {
            description: `Run ${command}`,
            docs: `Executes ${command} with optional flags like :fix and :watch.`,
            example: `npx zerux ${command}`
        }
    );
}