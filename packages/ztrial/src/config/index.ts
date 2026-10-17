import {defaultConfig} from './defaults.js';
import {validateConfig} from './schema.js';
import type {ZtrialConfig} from '../types/config.js';
export function defineConfig(config:ZtrialConfig = {}): ZtrialConfig { return {...defaultConfig,...validateConfig(config)}; }
export {validateConfig,defaultConfig};
