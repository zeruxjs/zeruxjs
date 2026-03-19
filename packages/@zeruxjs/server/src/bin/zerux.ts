#!/usr/bin/env node

import chalk from "chalk";
import {
    portlessProxy,
    portlessRun,
    portlessList,
    portlessGet,
    portlessHosts,
    portlessTrust,
    portlessStop,
} from "../portless.js";

const CLI_NAME = "zerux-server";

/* ----------------------------- ARG PARSING ----------------------------- */

function getFlag(args: string[], name: string) {
    const idx = args.indexOf(name);
    if (idx === -1) return undefined;
    const val = args[idx + 1];
    if (!val || val.startsWith("-")) return true;
    return val;
}

/* -------------------------------------------------------------------------- */

async function main() {
    const args = process.argv.slice(2);

    try {
        if (!args.length || args.includes("--help")) {
            console.log(`${CLI_NAME} usage...`);
            return;
        }

        const cmd = args[0];

        /* ---------------- PROXY ---------------- */
        if (cmd === "proxy") {
            if (args[1] === "start") {
                const port = Number(getFlag(args, "--port") || 1355);
                const https = args.includes("--https");

                await portlessProxy(port, { https });
                return;
            }

            if (args[1] === "stop") {
                await portlessStop();
                return;
            }
        }

        /* ---------------- RUN ---------------- */
        if (cmd === "run") {
            const force = args.includes("--force");
            const appPort = Number(getFlag(args, "--app-port"));
            const name = getFlag(args, "--name") as string;

            const cmdArgs = args.slice(1).filter((a) => !a.startsWith("--"));

            await portlessRun(cmdArgs, {
                name,
                force,
                appPort: isNaN(appPort) ? undefined : appPort,
            });

            return;
        }

        /* ---------------- LIST ---------------- */
        if (cmd === "list") {
            await portlessList();
            return;
        }

        /* ---------------- GET ---------------- */
        if (cmd === "get") {
            console.log(await portlessGet(args[1]));
            return;
        }

        /* ---------------- HOSTS ---------------- */
        if (cmd === "hosts") {
            portlessHosts(args[1] === "clean" ? "clean" : "sync");
            return;
        }

        /* ---------------- TRUST ---------------- */
        if (cmd === "trust") {
            portlessTrust();
            return;
        }

        /* ---------------- NAMED MODE ---------------- */
        if (args.length >= 2) {
            const name = args[0];
            const cmdArgs = args.slice(1);

            await portlessRun(cmdArgs, { name });
            return;
        }
    } catch (err: any) {
        console.error(chalk.red(`${CLI_NAME}: ${err.message}`));
        process.exit(1);
    }
}

main();