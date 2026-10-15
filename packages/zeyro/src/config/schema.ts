import type { ZeyroConfig } from '../types/config.js';
export function validateConfig(value: unknown): ZeyroConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Config must be an object');
  const config=value as Record<string,unknown>;
  const permitted = ['timeoutMs','retries','reporter','files','root','bail','allowOnly','match','throwOnFailure'];
  for (const key of Object.keys(config)) if(!permitted.includes(key)) throw new TypeError(`Unknown config option: ${key}`);
  for(const key of ['timeoutMs','retries'] as const) if(config[key] !== undefined && (!Number.isSafeInteger(config[key]) || (config[key] as number) < (key === 'timeoutMs' ? 1 : 0))) throw new TypeError(`Invalid ${key}`);
  if(config.reporter !== undefined && !['pretty','json','tap'].includes(String(config.reporter))) throw new TypeError('Invalid reporter');
  if(config.match !== undefined && typeof config.match !== 'string' && !(config.match instanceof RegExp)) throw new TypeError('Invalid match');
  if(config.throwOnFailure !== undefined && typeof config.throwOnFailure !== 'boolean') throw new TypeError('Invalid throwOnFailure');
  if(config.retries !== undefined && (config.retries as number)>100) throw new TypeError('Invalid retries');
  if(config.timeoutMs !== undefined && (config.timeoutMs as number)>600_000) throw new TypeError('Timeout exceeds 10 minutes');
  if(config.root !== undefined && (typeof config.root!=='string'||!config.root)) throw new TypeError('Invalid root');
  if(config.files!==undefined && (!Array.isArray(config.files)||config.files.some(s=>typeof s!=='string'||!s||s.length>256))) throw new TypeError('Invalid files');
  if(config.bail !== undefined && typeof config.bail !== 'boolean') throw new TypeError('Invalid bail');
  if(config.allowOnly !== undefined && typeof config.allowOnly !== 'boolean') throw new TypeError('Invalid allowOnly');
  return value as ZeyroConfig;
}
