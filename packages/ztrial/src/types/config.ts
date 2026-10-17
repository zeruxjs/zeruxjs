import type { RunOptions } from './test.js';
export interface ZtrialConfig extends RunOptions { root?: string; files?: string[]; reporter?: 'pretty'|'json'|'tap'; bail?: boolean; allowOnly?: boolean }
