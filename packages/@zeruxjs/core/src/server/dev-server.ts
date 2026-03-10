import http from "node:http";
import crypto from "node:crypto";
import { WebSocketServer } from "ws";

export interface DevServer extends http.Server {
    build: (event: { type: string; file: string }) => boolean;
    broadcast: (data: any) => void;
    sendTo: (token: string, data: any) => void;
}

const VALID_TYPES = new Set(["new", "update", "delete"]);
const JS_EXT_REGEX = /\.(jsx?|tsx?)$/;

export function startDevServer(rootDir: string, port: number | null = null): Promise<DevServer> {
    return new Promise((resolve, reject) => {
        const createServer = (portToTry: number) => {
            const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
                res.end("Zerux running");
            }) as DevServer;

            server.on("error", (err: any) => {
                if (err.code === "EADDRINUSE") {
                    if (port !== null) reject(new Error(`Port ${portToTry} is already in use.`));
                    else createServer(portToTry + 1);
                } else {
                    reject(err);
                }
            });

            server.listen(portToTry, () => {
                console.log("Dev server:", portToTry);

                server.build = (event: { type: string; file: string }) => VALID_TYPES.has(event.type) && JS_EXT_REGEX.test(event.file);

                try {
                    const wss = new WebSocketServer({ server });
                    const clientMap = new Map(); // token => websocket client

                    wss.on("connection", (ws: any, req: http.IncomingMessage) => {
                        const url = new URL(req.url!, `ws://${req.headers.host}`);
                        const token = url.searchParams.get("token");

                        if (!token) {
                            // Assign a new token and tell the client to reconnect
                            const newToken = crypto.randomUUID();
                            ws.send(JSON.stringify({ type: "redirect", url: `?token=${newToken}` }));
                            ws.close();
                            return;
                        }

                        // Register the client using the provided token
                        clientMap.set(token, ws);
                        ws.token = token;

                        ws.on("close", () => {
                            if (clientMap.get(token) === ws) {
                                clientMap.delete(token);
                            }
                        });

                        ws.on("message", (data: any) => {
                            const value = data.toString();
                            console.log(`WebSocket message from [${token}]:`, value);
                            ws.send(JSON.stringify({ message: "reviced", value }));
                        });
                    });

                    // Broadcast to all active clients
                    server.broadcast = (data: any) => {
                        const payload = JSON.stringify(data);
                        for (const client of wss.clients) {
                            if (client.readyState === 1) client.send(payload);
                        }
                    };

                    // Send a message to a specific client by their token
                    server.sendTo = (token: string, data: any) => {
                        const client = clientMap.get(token);
                        if (client && client.readyState === 1) {
                            client.send(JSON.stringify(data));
                        }
                    };

                } catch (e) {
                    console.error("Failed to start WebSocket server:", e);
                }

                resolve(server);
            });
        };

        createServer(port ?? 9999);
    });
}