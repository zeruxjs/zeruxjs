import type { RunOptions } from './test.js';
/** Validated JSON/programmatic CLI configuration; file roots resolve under the CLI’s declared policy. */
export interface ZtrialConfig extends RunOptions {
  /** Host-selected discovery root; relative JSON roots resolve from the config directory. */
  root?: string;
  /** Explicit supported bounded glob patterns; discovery does not execute source to match paths. */
  files?: string[];
  /** Fixed supported CLI text/JSON/TAP presentation mode. */
  reporter?: 'pretty' | 'json' | 'tap';
  /** Stop starting later eligible cases after a failure/unavailable result while cleaning reached suites. */
  bail?: boolean;
  /** Explicit CLI permission for focused registrations. */
  allowOnly?: boolean;
}
