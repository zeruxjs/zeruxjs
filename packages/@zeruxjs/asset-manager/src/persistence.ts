import {AssetManager} from './manager.js';
import type {AssetSnapshot} from './types.js';
import {readCatalogData,writeCatalogData} from './catalog-io.js';
export async function saveAssetCatalog(manager:AssetManager,file:string):Promise<void>{await writeCatalogData(file,manager.snapshot());}
export async function loadAssetCatalog(file:string):Promise<AssetManager>{const catalog=new AssetManager();catalog.load(await readCatalogData(file) as AssetSnapshot);return catalog;}
