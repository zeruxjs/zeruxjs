import http from "node:http";

let assignedPort: number | null = null;

export function startAppServer(rootDir: string, port: number | null = null): Promise<http.Server> {
    return new Promise((resolve, reject) => {
        const isFixedPort = port !== null || assignedPort !== null;
        const createServer = (portToTry: number) => {
            const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
                res.end("Zerux running");
            });

            server.on("error", (err: any) => {
                if (err.code === "EADDRINUSE") {
                    if (isFixedPort) reject(new Error(`Port ${portToTry} is already in use.`));
                    else createServer(portToTry + 1);
                } else {
                    reject(err);
                }
            });

            server.listen(portToTry, () => {
                assignedPort = portToTry;
                console.log(`App Server is running at http://localhost:${portToTry}`);
                resolve(server);
            });
        };

        createServer(port ?? assignedPort ?? 3000);
    });
}