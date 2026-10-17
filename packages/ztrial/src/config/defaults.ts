import type { ZtrialConfig } from '../types/config.js';
export const defaultConfig: Readonly<ZtrialConfig> = Object.freeze({ timeoutMs:5000,retries:0,reporter:'pretty',files:['**/*.test.mjs','**/*.test.js','**/*.spec.mjs','**/*.spec.js'],root:'.',bail:false,allowOnly:true });
