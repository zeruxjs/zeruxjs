import { ProxyResponseCache, type ProxyCacheOptions } from '../portless/proxy-cache.js';
import { ProxyAdmission, type ProxyAdmissionOptions } from '../portless/proxy-admission.js';
import { validateProxyBindAddress } from '../portless/proxy-headers.js';
import { validateCompressionOptions, type ProxyCompressionOptions, type CompressionEncoding } from '../portless/proxy-compression.js';
export interface ProxyStartArguments {
  port?: number;
  https: boolean;
  bindHost?: string;
  limits: ProxyAdmissionOptions;
  compression?: ProxyCompressionOptions;
  cache?: ProxyCacheOptions;
}
/** Strict option parsing: no implicit shell evaluation, no partial numbers, no repeats. */
export function parseProxyStartArguments(flags: readonly string[]): ProxyStartArguments {
  const allowed = new Set(['--port', '--https', '--bind', '--rate', '--burst', '--max-active', '--max-body', '--compress', '--no-compress', '--compression-min', '--compression-encodings', '--cache', '--no-cache', '--cache-max-entries', '--cache-max-entry-bytes', '--cache-max-total-bytes', '--cache-max-age']);
  const result: ProxyStartArguments = { https: false, limits: {} };
  const seen = new Set<string>();
  for (let i = 0; i < flags.length; i++) {
    const flag = flags[i];
    if (!allowed.has(flag)) throw new Error(`Unknown proxy start option: ${flag}`);
    if (seen.has(flag)) throw new Error(`Repeated proxy option: ${flag}`);
    seen.add(flag);
    if (flag === '--https') { result.https = true; continue; }
    if (flag === '--cache' || flag === '--no-cache') { result.cache = { ...result.cache, enabled: flag === '--cache' }; continue; }
    if (flag === '--compress' || flag === '--no-compress') { result.compression = { ...result.compression, enabled: flag === '--compress' }; continue; }
    const raw = flags[++i];
    if (flag === '--compression-encodings') {
      const encodings = (raw ?? '').split(',') as CompressionEncoding[];
      result.compression = { ...result.compression, encodings };
      continue;
    }
    if (flag === '--bind') {
      if (!raw) throw new Error('Missing proxy bind address');
      result.bindHost = validateProxyBindAddress(raw);
      continue;
    }
    if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw)) || Number(raw) < 1) {
      throw new Error(`Invalid proxy ${flag} value`);
    }
    const value = Number(raw);
    if (flag === '--port') { if (value > 65535) throw new RangeError('Invalid proxy port'); result.port = value; }
    else if (flag === '--rate') result.limits.ratePerSecond = value;
    else if (flag === '--burst') result.limits.burst = value;
    else if (flag === '--max-active') result.limits.maxActiveRequests = value;
    else if (flag === '--max-body') result.limits.maxBodyBytes = value;
    else if (flag === '--compression-min') result.compression = { ...result.compression, minBytes: value };
    else if (flag === '--cache-max-entries') result.cache = { ...result.cache, maxEntries: value };
    else if (flag === '--cache-max-entry-bytes') result.cache = { ...result.cache, maxEntryBytes: value };
    else if (flag === '--cache-max-total-bytes') result.cache = { ...result.cache, maxTotalBytes: value };
    else if (flag === '--cache-max-age') result.cache = { ...result.cache, maxAgeSeconds: value };
  }
  // Validate all limits before any attempt to bind a listener or write state.
  new ProxyAdmission(result.limits);
  if (result.compression) validateCompressionOptions(result.compression);
  if (result.cache) new ProxyResponseCache(result.cache);
  return result;
}
