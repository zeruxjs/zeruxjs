export interface AssetVariant { url?: string; value?: string; metadata?: Record<string,string> }
export interface Asset { id: string; name: string; type: 'image'|'video'|'font'|'color'|'document'|'other'; url?: string; value?: string; tags?: string[]; metadata?: Record<string,string>; variants?: Record<string, AssetVariant> }
export interface AssetFilter { type?: Asset['type']; tag?: string; query?: string; limit?: number; offset?: number }
export interface AssetSnapshot { version: 1; assets: Asset[]; revision?: number }
export type AssetOperation = { action: 'add'; asset: Asset } | { action: 'update'; id: string; changes: Partial<Omit<Asset, 'id'>> } | { action: 'remove'; id: string };
