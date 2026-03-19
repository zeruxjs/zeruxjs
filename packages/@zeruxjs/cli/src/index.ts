import chalk from "chalk";
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

type CommandHandler = (args: string[]) => Promise<void> | void;

interface CommandOptions {
    rea?: boolean;
    description?: string;
    help?: { arg: string; "its description": string }[];
    docs?: string;
    example?: string;
}

interface Command {
    name: string;
    options: CommandOptions;
    handler: CommandHandler;
}

interface KeyOptions {
    description?: string;
    func?: () => void;
}

class ZeruxCLI {
    private static keys: Map<string, Map<string, Command>> = new Map();
    private static keyOptions: Map<string, KeyOptions> = new Map();

    private static isDocs = false;
    private static isHelp = false;
    private static isList = false;
    private static isRea = false;
    private static loadedPlugins = false;

    private command: string | undefined;
    private args: string[];

    constructor() {
        const [, , command, ...args] = process.argv;
        this.command = command;
        this.args = args;

        const checkFlag = (val: string) => {
            if (val === "--docs" || val === "-d") ZeruxCLI.isDocs = true;
            if (val === "--help" || val === "-h") ZeruxCLI.isHelp = true;
            if (val === "--list" || val === "-l") ZeruxCLI.isList = true;
        };

        if (this.command) {
            checkFlag(this.command);
            if (this.command.startsWith("-")) {
                ZeruxCLI.isRea = true;
            }
        }

        this.args.forEach(checkFlag);
    }

    private findNodeModules(start: string): string | null {
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

    private loadPackage(pkgPath: string) {
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

    private loadPlugins() {
        if (ZeruxCLI.loadedPlugins) return;
        ZeruxCLI.loadedPlugins = true;

        const nodeModules = this.findNodeModules(process.cwd());

        if (!nodeModules) {
            return;
        }

        const packages = fs.readdirSync(nodeModules);

        for (const pkg of packages) {
            if (pkg.startsWith(".")) continue;

            const pkgPath = path.join(nodeModules, pkg);

            // Scoped packages like @zeruxjs are grouped inside a folder starting with "@"
            if (pkg.startsWith("@")) {
                const scopePackages = fs.readdirSync(pkgPath);

                for (const scoped of scopePackages) {
                    this.loadPackage(path.join(pkgPath, scoped));
                }
            } else {
                // Parse all normal packages that do not start with "@"
                this.loadPackage(pkgPath);
            }
        }
    }

    addKey(keyword: string, options?: KeyOptions) {
        if (!ZeruxCLI.keys.has(keyword)) {
            ZeruxCLI.keys.set(keyword, new Map());
        }

        if (options) {
            ZeruxCLI.keyOptions.set(keyword, options);

            if (options.func) {
                options.func();
            }
        }

        // Auto-run once registration is complete
        setImmediate(() => {
            this.run(keyword);
        });
    }

    addCommand(keyword: string, name: string, handler: CommandHandler, options?: CommandOptions | string) {
        const opts: CommandOptions = typeof options === "string" ? { description: options } : (options || {});

        if (!ZeruxCLI.keys.has(keyword)) {
            ZeruxCLI.keys.set(keyword, new Map());
        }

        const keyCommands = ZeruxCLI.keys.get(keyword)!;

        // First come, first serve: ignore duplicate commands
        if (keyCommands.has(name)) return;

        const cmdObj: Command = { name, options: opts, handler };
        keyCommands.set(name, cmdObj);

        // Immediate Execution Check
        if (this.command === name) {
            if (ZeruxCLI.isHelp) {
                this.showCommandHelp(cmdObj);
                process.exit(0);
            }

            if (ZeruxCLI.isDocs) {
                this.showCommandDocs(cmdObj);
                process.exit(0);
            }

            if (!ZeruxCLI.isRea && !opts.rea) {
                this.loadPlugins();
                Promise.resolve(handler(this.args)).then(() => process.exit(0)).catch((err) => {
                    this.error(err?.message || String(err));
                    process.exit(1);
                });
            }
        }
    }

    private async run(keyword: string) {
        this.loadPlugins();

        // Handle global flags with keyword context
        if (ZeruxCLI.isList && (this.command === "--list" || this.command === "-l")) {
            this.showList(keyword);
            process.exit(0);
        }

        if (ZeruxCLI.isHelp && (this.command === "--help" || this.command === "-h")) {
            this.showAllHelp(keyword);
            process.exit(0);
        }

        const keyCommands = ZeruxCLI.keys.get(keyword);

        if (!this.command || this.command.startsWith("-")) {
            this.log(keyword + ": command not found.");
            process.exit(0);
        }

        if (!keyCommands) {
            this.error(`Unknown CLI keyword "${keyword}"`);
            process.exit(1);
        }

        const cmd = keyCommands.get(this.command);

        if (!cmd) {
            this.error(`Unknown command "${this.command}"`);
            process.exit(1);
        }

        await cmd.handler(this.args);
        process.exit(0);
    }

    private showList(keyword: string) {
        const keyCommands = ZeruxCLI.keys.get(keyword);
        if (!keyCommands) return;

        this.log(chalk.bold(`Available commands for ${keyword}:`));
        keyCommands.forEach((cmd) => {
            const desc = cmd.options?.description || "";
            this.log(`  ${chalk.cyan(cmd.name.padEnd(15))} ${desc}`);
        });
    }

    private showAllHelp(keyword: string) {
        const keyOptions = ZeruxCLI.keyOptions.get(keyword);
        const keyCommands = ZeruxCLI.keys.get(keyword);

        this.log(chalk.bold.yellow(`Help for ${keyword}:`));
        if (keyOptions?.description) {
            this.log(keyOptions.description);
        }

        if (keyCommands) {
            this.log(chalk.bold("\nCommands:"));
            keyCommands.forEach((cmd) => {
                const desc = cmd.options?.description || "";
                this.log(`  ${chalk.cyan(cmd.name.padEnd(15))} ${desc}`);
            });
        }
    }

    private showCommandHelp(cmd: Command) {
        this.log(chalk.bold.yellow(`Help: ${cmd.name}`));
        if (cmd.options.description) {
            this.log(cmd.options.description);
        }

        if (cmd.options.help && cmd.options.help.length > 0) {
            this.log(chalk.bold("\nArguments:"));
            cmd.options.help.forEach((h) => {
                this.log(`  ${chalk.cyan(h.arg.padEnd(15))} ${h["its description"]}`);
            });
        }

        if (cmd.options.example) {
            this.log(chalk.bold("\nExample:"));
            this.log(`  ${cmd.options.example}`);
        }
    }

    private showCommandDocs(cmd: Command) {
        this.log(chalk.bold.yellow(`Documentation for ${cmd.name}:`));
        this.log(cmd.options.docs || "No detailed documentation available.");
    }

    success(message: string) {
        console.log(chalk.green(`✔ ${message}`));
    }

    error(message: string) {
        console.error(chalk.red(`✖ ${message}`));
    }

    log(message: string) {
        console.log(message);
    }

    color = chalk;
}

export const cli = new ZeruxCLI();
export default cli;
