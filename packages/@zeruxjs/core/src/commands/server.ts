import { startServer } from "@zeruxjs/server";

export const server = async (mode: 'dev' | 'start' = 'start', args: { namedArgs: any, positionalArgs: any }) => {
    const rootDir = process.cwd();
    startServer({});
};