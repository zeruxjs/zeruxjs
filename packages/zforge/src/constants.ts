import os from "node:os";
import path from "node:path";

export const SHARED_DEV_FILE = path.join(os.tmpdir(), "zdev-dev.json");
export const DEFAULT_SHARED_PORT = 9000;
export const CLIENT_EVENT_LIMIT = 50;
export const LOG_LINE_LIMIT = 200;
