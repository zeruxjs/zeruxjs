/** Durable governance is stored inside the same version-CAS document as the draft.
 * A worker can never observe a partial draft/publish transition. */
import type {TagContainer,TagContainerStore,TagRelease,TagGovernance} from './types.js';
import {validateContainer} from './container.js';

function snapshot(input:TagContainer):TagContainer {
  const {governance: _unused,...definition}=input;
  return validateContainer(definition);
}
/** analytics_tag_containers uses a portable SQL TEXT field (MySQL <= 64 KiB).
 * Prune oldest retained releases before updating the CAS row; never prune live. */
const MAX_DOCUMENT_BYTES=58_000;
function bounded(document:TagContainer):TagContainer {
  const checked=validateContainer(document);
  while(Buffer.byteLength(JSON.stringify(checked),'utf8')>MAX_DOCUMENT_BYTES && (checked.governance?.history.length??0)>1){
    checked.governance!.history.shift();
  }
  if(Buffer.byteLength(JSON.stringify(checked),'utf8')>MAX_DOCUMENT_BYTES)throw new RangeError('Tag release document exceeds portable storage limit');
  return checked;
}
function initial(input:TagContainer):TagGovernance {
  const base=snapshot(input);
  return {release:1,published:base,history:[{id:1,at:new Date().toISOString(),action:'initial',container:base}]};
}
function append(g:TagGovernance,container:TagContainer,action:'publish'|'rollback'):TagGovernance {
  const published=snapshot(container),release=g.release+1;
  const record:TagRelease={id:release,at:new Date().toISOString(),action,container:published};
  return {release,published,history:[...g.history,record].slice(-12)};
}
/** Existing single-container documents are treated as release #1 until the first edit. */
export function publishedContainer(document:TagContainer):TagContainer {
  const parsed=validateContainer(document);
  return snapshot(parsed.governance?.published??parsed);
}
export function releaseSummary(document:TagContainer){
  const parsed=validateContainer(document),g=parsed.governance??initial(parsed);
  return {draftRevision:parsed.version,publishedRelease:g.release,publishedRevision:g.published.version,
    unpublishedChanges:JSON.stringify(snapshot(parsed))!==JSON.stringify(g.published),
    history:g.history.map(({id,at,action,container})=>({id,at,action,revision:container.version}))};
}
export async function saveTagDraft(store:TagContainerStore,next:TagContainer,expectedVersion:number):Promise<boolean> {
  const current=validateContainer(await store.load());
  if(current.version!==expectedVersion||next.version!==expectedVersion+1||next.id!==current.id)return false;
  // Governance is server-controlled; ignore any metadata sent by the editor.
  return store.save(bounded({...snapshot(next),governance:current.governance??initial(current)}),expectedVersion);
}
export async function publishTagDraft(store:TagContainerStore,expectedVersion:number):Promise<boolean> {
  const current=validateContainer(await store.load());if(current.version!==expectedVersion)return false;
  const governance=append(current.governance??initial(current),current,'publish');
  return store.save(bounded({...current,version:current.version+1,governance}),expectedVersion);
}
export async function rollbackTagRelease(store:TagContainerStore,expectedVersion:number,releaseId:number):Promise<boolean> {
  const current=validateContainer(await store.load());if(current.version!==expectedVersion)return false;
  const governance=current.governance??initial(current);
  const entry=governance.history.find(item=>item.id===releaseId);
  if(!entry)throw new RangeError('Release not available in retained history');
  const updated=append(governance,entry.container,'rollback');
  return store.save(bounded({...current,version:current.version+1,governance:updated}),expectedVersion);
}
