import chalk from "chalk";

type CommandHandler = (args: string[]) => Promise<void> | void;

interface Command {
    name: string;
    description?: string;
    handler: CommandHandler;
}

class ZeruxCLI {
    private commands: Map<string, Command> = new Map();
    private keys: Map<string, Map<string, Command>> = new Map();

    addKey(keyword: string) {
        if (!this.keys.has(keyword)) {
            this.keys.set(keyword, new Map());
        }
    }

    addCommand(keyword: string, name: string, handler: CommandHandler, description?: string) {
        if (!this.keys.has(keyword)) {
            this.keys.set(keyword, new Map());
        }

        const keyCommands = this.keys.get(keyword)!;

        keyCommands.set(name, {
            name,
            description,
            handler
        });
    }

    async run(keyword: string, command: string, args: string[]) {
        const keyCommands = this.keys.get(keyword);

        if (!keyCommands) {
            this.error(`Unknown CLI keyword "${keyword}"`);
            process.exit(1);
        }

        const cmd = keyCommands.get(command);

        if (!cmd) {
            this.error(`Unknown command "${command}"`);
            process.exit(1);
        }

        await cmd.handler(args);
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