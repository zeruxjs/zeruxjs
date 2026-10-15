import type { RunOptions } from './test.js';
export interface ZeyroConfig extends RunOptions { root?: string; files?: string[]; reporter?: 'pretty'|'json'|'tap'; bail?: boolean; allowOnly?: boolean }
