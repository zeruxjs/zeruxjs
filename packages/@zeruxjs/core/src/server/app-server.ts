import http from "node:http";

export function startAppServer(rootDir: string, port: number | null = null): Promise<http.Server> {
    return new Promise((resolve, reject) => {
        const createServer = (portToTry: number) => {
            const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
                res.end("Zerux running");
            });

            server.on("error", (err: any) => {
                if (err.code === "EADDRINUSE") {
                    if (port !== null) reject(new Error(`Port ${portToTry} is already in use.`));
                    else createServer(portToTry + 1);
                } else {
                    reject(err);
                }
            });

            server.listen(portToTry, () => {
                console.log("App server:", portToTry);
                resolve(server);
            });
        };

        createServer(port ?? 3000);
    });
}