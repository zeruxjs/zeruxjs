// index.ts

export * from "./portless/types.js";
export * from "./portless/proxy.js";
export * from "./portless/routes.js";
export * from "./portless/utils.js";
export * from "./portless/hosts.js";

import chalk from "chalk";
import * as fs from "node:fs";

import {
    createSNICallback,
    ensureCerts,
    isCATrusted,
    trustCA,
} from "./portless/certs.js";

import { createProxyServer } from "./portless/proxy.js";
import { formatUrl, parseHostname } from "./portless/utils.js";
import { syncHostsFile, cleanHostsFile } from "./portless/hosts.js";
import { FILE_MODE, RouteStore, RouteConflictError } from "./portless/routes.js";

import {
    DEFAULT_TLD,
    discoverState,
    findFreePort,
    injectFrameworkFlags,
    isHttpsEnvEnabled,
    isProxyRunning,
    waitForProxy,
    readTlsMarker,
    readTldFromDir,
    resolveStateDir,
    spawnCommand,
} from "./portless/cli-utils.js";

import { inferProjectName, detectWorktreePrefix } from "./portless/auto.js";

const CLI_NAME = "zerux-server";

/* -------------------------------------------------------------------------- */
/*                                  PROXY                                     */
/* -------------------------------------------------------------------------- */

export async function portlessProxy(
    port?: number,
    options?: {
        https?: boolean;
        tld?: string;
        certPath?: string;
        keyPath?: string;
    }
): Promise<boolean> {
    try {
        const proxyPort = port ?? 1355;
        const tld = options?.tld ?? DEFAULT_TLD;
        const useHttps = options?.https ?? isHttpsEnvEnabled();

        const stateDir = resolveStateDir(proxyPort);
        const store = new RouteStore(stateDir);

        if (await isProxyRunning(proxyPort)) {
            console.log(chalk.yellow(`${CLI_NAME}: Proxy already running on ${proxyPort}`));
            return true;
        }

        let tlsOptions: any;

        if (useHttps) {
            store.ensureDir();

            if (options?.certPath && options?.keyPath) {
                tlsOptions = {
                    cert: fs.readFileSync(options.certPath),
                    key: fs.readFileSync(options.keyPath),
                };
            } else {
                const certs = ensureCerts(stateDir);

                if (!isCATrusted(stateDir)) {
                    trustCA(stateDir);
                }

                const cert = fs.readFileSync(certs.certPath);
                const key = fs.readFileSync(certs.keyPath);

                tlsOptions = {
                    cert,
                    key,
                    SNICallback: createSNICallback(stateDir, cert, key, tld),
                };
            }
        }

        const server = createProxyServer({
            getRoutes: () => store.loadRoutes(),
            proxyPort,
            tld,
            onError: (msg) => console.error(chalk.red(msg)),
            tls: tlsOptions,
        });

        return new Promise((resolve) => {
            server.listen(proxyPort, () => {
                fs.writeFileSync(store.pidPath, process.pid.toString(), { mode: FILE_MODE });
                fs.writeFileSync(store.portFilePath, proxyPort.toString(), { mode: FILE_MODE });

                console.log(
                    chalk.green(`${CLI_NAME}: Proxy running on ${proxyPort} (${useHttps ? "HTTPS" : "HTTP"})`)
                );
                resolve(true);
            });

            server.on("error", (err) => {
                console.error(chalk.red(`${CLI_NAME}: ${err.message}`));
                resolve(false);
            });
        });
    } catch (err) {
        console.error(chalk.red(`${CLI_NAME}: ${err instanceof Error ? err.message : String(err)}`));
        return false;
    }
}

/* -------------------------------------------------------------------------- */
/*                                  STOP                                      */
/* -------------------------------------------------------------------------- */

export async function portlessStop(): Promise<boolean> {
    try {
        const { dir } = await discoverState();
        const store = new RouteStore(dir);

        if (!fs.existsSync(store.pidPath)) {
            console.log(chalk.yellow(`${CLI_NAME}: Proxy not running`));
            return true;
        }

        const pid = parseInt(fs.readFileSync(store.pidPath, "utf-8"), 10);

        process.kill(pid, "SIGTERM");
        fs.unlinkSync(store.pidPath);
        try {
            fs.unlinkSync(store.portFilePath);
        } catch { }
        console.log(chalk.green(`${CLI_NAME}: Proxy stopped`));
        return true;
    } catch (err) {
        console.error(chalk.red(`${CLI_NAME}: Failed to stop proxy`));
        return false;
    }
}

/* -------------------------------------------------------------------------- */
/*                                   RUN                                      */
/* -------------------------------------------------------------------------- */

export async function portlessRun(
    commandArgs: string[],
    options?: {
        name?: string;
        force?: boolean;
        appPort?: number;
    }
): Promise<boolean> {
    try {
        if (!commandArgs.length) {
            throw new Error("No command provided");
        }

        let baseName: string;
        let nameSource: string;

        if (options?.name) {
            baseName = options.name;
            nameSource = "--name";
        } else {
            const inferred = inferProjectName();
            baseName = inferred.name;
            nameSource = inferred.source;
        }

        const worktree = detectWorktreePrefix();
        const finalName = worktree ? `${worktree.prefix}.${baseName}` : baseName;

        const { dir, port, tls, tld } = await discoverState();
        const store = new RouteStore(dir);

        if (!(await isProxyRunning(port, tls))) {
            await portlessProxy(port);
            await waitForProxy(port);
        }

        const hostname = parseHostname(finalName, tld);
        const appPort = options?.appPort ?? (await findFreePort());

        store.addRoute(hostname, appPort, process.pid, options?.force);

        const url = formatUrl(hostname, port, tls);

        console.log(chalk.cyan(`${CLI_NAME}: ${url}`));

        injectFrameworkFlags(commandArgs, appPort);

        spawnCommand(commandArgs, {
            env: {
                ...process.env,
                PORT: appPort.toString(),
                HOST: "127.0.0.1",
                PORTLESS_URL: url,
            },
            onCleanup: () => {
                try {
                    store.removeRoute(hostname);
                } catch { }
            },
        });
        return true;
    } catch (err) {
        console.error(chalk.red(`${CLI_NAME}: ${err instanceof Error ? err.message : String(err)}`));
        return false;
    }
}

/* -------------------------------------------------------------------------- */
/*                                  UTILS                                     */
/* -------------------------------------------------------------------------- */

export async function portlessList(): Promise<boolean> {
    try {
        const { dir, port, tls } = await discoverState();
        const store = new RouteStore(dir);

        const routes = store.loadRoutes();
        routes.forEach((r) => {
            console.log(`${formatUrl(r.hostname, port, tls)} -> localhost:${r.port}`);
        });
        return true;
    } catch (err) {
        console.error(chalk.red(`${CLI_NAME}: ${err instanceof Error ? err.message : String(err)}`));
        return false;
    }
}

export async function portlessAlias(
    name: string,
    port?: number,
    options?: {
        remove?: boolean;
        force?: boolean;
    }
): Promise<boolean> {
    try {
        const { dir, tld } = await discoverState();

        const store = new RouteStore(dir, {
            onWarning: (msg) => console.warn(chalk.yellow(msg)),
        });

        const hostname = parseHostname(name, tld);

        // REMOVE
        if (options?.remove) {
            const routes = store.loadRoutes();
            const exists = routes.find((r) => r.hostname === hostname && r.pid === 0);

            if (!exists) {
                throw new Error(`Alias not found: ${hostname}`);
            }

            store.removeRoute(hostname);
            console.log(chalk.green(`${CLI_NAME}: Removed alias ${hostname}`));
            return true;
        }

        // ADD
        if (!port) {
            throw new Error("Port is required for alias");
        }

        if (port < 1 || port > 65535) {
            throw new Error(`Invalid port: ${port}`);
        }

        store.addRoute(hostname, port, 0, options?.force);

        console.log(
            chalk.green(`${CLI_NAME}: Alias ${hostname} -> 127.0.0.1:${port}`)
        );
        return true;
    } catch (err) {
        console.error(chalk.red(`${CLI_NAME}: ${err instanceof Error ? err.message : String(err)}`));
        return false;
    }
}

export async function portlessGet(name: string): Promise<string | false> {
    try {
        const { port, tls, tld } = await discoverState();
        return formatUrl(parseHostname(name, tld), port, tls);
    } catch {
        return false;
    }
}

export function portlessHosts(action: "sync" | "clean" = "sync"): boolean {
    try {
        if (action === "clean") return cleanHostsFile();

        const store = new RouteStore(resolveStateDir(1355));
        return syncHostsFile(store.loadRoutes().map((r) => r.hostname));
    } catch {
        return false;
    }
}

export function portlessTrust(): boolean {
    try {
        const result = trustCA(resolveStateDir(1355));
        if (result.error) {
            console.error(chalk.red(`${CLI_NAME}: ${result.error}`));
        }
        return result.trusted;
    } catch {
        return false;
    }
}