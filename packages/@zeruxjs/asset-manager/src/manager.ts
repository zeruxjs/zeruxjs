import type { Asset, AssetFilter, AssetSnapshot, AssetOperation } from './types.js';
import { validateAsset } from './validation.js';
import { resolveAssetVariant } from './variants.js';

export class AssetRevisionError extends Error { constructor() { super('Asset catalog revision conflict'); this.name = 'AssetRevisionError'; } }
export class AssetManager {
 private readonly assets = new Map<string, Asset>();
 private sequence = 0;
 get revision(): number { return this.sequence; }
 get size(): number { return this.assets.size; }
 add(asset: Asset): Asset { const copy = validateAsset(asset); this.assets.set(copy.id, copy); this.sequence++; return structuredClone(copy); }
 addMany(assets: Iterable<Asset>): void { this.apply([...assets].map(asset => ({ action: 'add' as const, asset }))); }
 update(id: string, changes: Partial<Omit<Asset,'id'>>): Asset {
   const current = this.assets.get(id); if (!current) throw new Error('Asset not found');
   return this.add({ ...current, ...changes, id });
 }
 /** Atomic multi-operation transaction, with optional optimistic revision check. */
 apply(operations: Iterable<AssetOperation>, expectedRevision?: number): number {
   if (expectedRevision !== undefined && expectedRevision !== this.sequence) throw new AssetRevisionError();
   const staging = new Map(this.assets);
   let changed = false;
   for (const operation of operations) {
     if (operation.action === 'add') { const next = validateAsset(operation.asset); staging.set(next.id, next); changed = true; }
     else if (operation.action === 'update') { const current = staging.get(operation.id); if (!current) throw new Error('Asset not found'); staging.set(operation.id, validateAsset({ ...current, ...operation.changes, id: operation.id })); changed = true; }
     else if (operation.action === 'remove') { if (staging.delete(operation.id)) changed = true; }
     else throw new TypeError('Unsupported asset operation');
   }
   if (changed) { this.assets.clear(); for (const [id,asset] of staging) this.assets.set(id,asset); this.sequence++; }
   return this.sequence;
 }
 get(id: string): Asset | undefined { const value = this.assets.get(id); return value ? structuredClone(value) : undefined; }
 resolve(id: string, variant?: string): ReturnType<typeof resolveAssetVariant> | undefined { const asset = this.get(id); return asset ? resolveAssetVariant(asset, variant) : undefined; }
 has(id: string): boolean { return this.assets.has(id); }
 remove(id: string): boolean { const removed = this.assets.delete(id); if (removed) this.sequence++; return removed; }
 clear(): void { if (this.assets.size) { this.assets.clear(); this.sequence++; } }
 list(filter: AssetFilter = {}): Asset[] {
   const limit = filter.limit ?? 10000, offset = filter.offset ?? 0;
   if (!Number.isSafeInteger(limit) || limit < 0 || limit > 10000 || !Number.isSafeInteger(offset) || offset < 0) throw new RangeError('Invalid pagination');
   const query = filter.query?.toLocaleLowerCase();
   return [...this.assets.values()].filter(a => (!filter.type || a.type === filter.type) && (!filter.tag || a.tags?.includes(filter.tag)) && (!query || a.name.toLocaleLowerCase().includes(query) || a.id.toLocaleLowerCase().includes(query) || a.tags?.some(t => t.toLocaleLowerCase().includes(query)))).slice(offset, offset + limit).map(a => structuredClone(a));
 }
 snapshot(): AssetSnapshot { return { version: 1, assets: [...this.assets.values()].map(asset => structuredClone(asset)), revision: this.sequence }; }
 load(snapshot: AssetSnapshot): void {
   if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.assets) || snapshot.assets.length > 100000 || (snapshot.revision !== undefined && (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0))) throw new TypeError('Unsupported asset snapshot');
   const next = new AssetManager(); next.addMany(snapshot.assets);
   if (next.size !== snapshot.assets.length) throw new TypeError('Duplicate asset IDs');
   this.assets.clear(); for (const [id,asset] of next.assets) this.assets.set(id,asset);
   this.sequence = snapshot.revision ?? this.sequence + 1;
 }
 export(): string { return JSON.stringify(this.snapshot().assets); }
 import(json: string): void { const parsed: unknown = JSON.parse(json); if (!Array.isArray(parsed) || parsed.length > 100000) throw new TypeError('Expected asset array'); this.addMany(parsed as Asset[]); }
}
export function createAssetManager(): AssetManager { return new AssetManager(); }
