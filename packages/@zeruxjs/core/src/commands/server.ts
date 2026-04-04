import { startServer } from "@zeruxjs/server";
import fs from "fs";
import path from "path";

const getConfig = async (mode: 'dev' | 'start' = 'start') => {
    const rootDir = process.cwd();

    // Get Configuration.
    let config: any = {};
    for (const ext of [".ts", ".js", ".mjs"]) {
        const configPath = path.join(rootDir, `zerux.config${ext}`);
        if (fs.existsSync(configPath)) {
            try {
                if (ext === ".json") {
                    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
                } else {
                    const cacheBuster = mode === 'dev' ? `?t=${Date.now()}` : '';
                    const mod = await import(`file://${configPath}${cacheBuster}`);
                    config = mod.default || mod.zeruxConfig || mod;
                }
                break;
            } catch (err: any) {
                console.error(`[zerux] Error loading ${configPath}:`, err.message);
            }
        }
    }
    return config;
}

export const server = async (mode: 'dev' | 'start' = 'start', args: { namedArgs: any, positionalArgs: any }, options: any) => {
    const rootDir = process.cwd();

    const config = await getConfig(mode);
    const packageJsonPath = path.join(rootDir, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    const projectName = packageJson.name;

    const mainFile = packageJson.main || "index.js";
    const mainPath = path.join(rootDir, mainFile);

    const loadAppFunc = async () => {
        try {
            const cacheBuster = mode === 'dev' ? `?t=${Date.now()}` : '';
            const modulePath = `file://${mainPath}${cacheBuster}`;
            const m = await import(modulePath);
            return m.default || m.app || m.server || m.handler;
        } catch (err: any) {
            console.error(`[zerux] Failed to load application entry (${mainFile}):`, err.message);
            return (req: any, res: any) => {
                res.writeHead(500);
                res.end(`Load Error: ${err.message}`);
            };
        }
    };

    const details: any = {
        service: 'zerux',
        config: config,
        app: {
            name: projectName,
            port: args.namedArgs?.p || args.namedArgs?.port ? parseInt(args.namedArgs.p || args.namedArgs.port) : undefined,
            func: await loadAppFunc(),
        }
    };

    if (mode === 'dev') {
        let devFunc;
        try {
            // @ts-ignore
            const devModule = await import("@zeruxjs/dev").catch(() => null);
            devFunc = devModule?.default || devModule?.app || devModule?.handler || devModule?.server;
        } catch (err) { }

        details.dev = {
            port: args.namedArgs?.devPort ? parseInt(args.namedArgs.devPort) : undefined,
            func: devFunc || ((req: any, res: any) => {
                if (req.url === '/') {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end('<h1>ZeRux Dev Site</h1><p>Dev frontend is not ready yet. Develop mode active.</p>');
                }
            }),
            watchTriggerFunc: (event: any) => {
                if (event.file?.includes("node_modules")) return false;
                if (event.file?.includes(".log")) return false;
                if (event.file?.includes(`.${projectName}`)) return false; // stop infinite reload loop on server.json updates
                if (event.file?.includes(".zerux")) return false; // same here for .zerux config files
                return true;
            },
            watchFunc: async (file: string) => {
                details.app.func = await loadAppFunc();
            }
        };
    }

    await startServer(details);

    // Keep the process alive so the CLI doesn't call process.exit(0)
    return new Promise(() => { });
};