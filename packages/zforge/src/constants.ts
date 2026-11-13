import os from 'node:os';
import path from 'node:path';

/** Process-independent private registry path shared by the legacy development server. */
export const SHARED_DEV_FILE = path.join(os.tmpdir(), 'zdev-dev.json');
/** Initial preferred loopback port; the registry may select a different available port. */
export const DEFAULT_SHARED_PORT = 9000;
/** Maximum client event records retained in one application snapshot. */
export const CLIENT_EVENT_LIMIT = 50;
/** Default maximum log-tail lines exposed through a development snapshot. */
export const LOG_LINE_LIMIT = 200;
