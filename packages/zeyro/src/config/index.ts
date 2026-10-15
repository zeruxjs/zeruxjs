import {defaultConfig} from './defaults.js';
import {validateConfig} from './schema.js';
import type {ZeyroConfig} from '../types/config.js';
export function defineConfig(config:ZeyroConfig = {}): ZeyroConfig { return {...defaultConfig,...validateConfig(config)}; }
export {validateConfig,defaultConfig};
