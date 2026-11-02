import {createEvidenceRetriever,createEvidenceAssistant} from '@zeruxjs/ai-model/evidence';
// Snapshot/hash come from the current successful corpus build, identity/permissions from host auth.
export function configureEvidence({snapshot,expectedManifestHash,principal,authorize,provider}){
 const retriever=createEvidenceRetriever(snapshot,{
  expectedManifestHash,principal,authorize,
  ranking:{weights:{title:8,text:1,symbols:4},normalization:'NFKC',foldDiacritics:true},
  maxTokens:4096,maxCharacters:16000,minSources:1,
 });
 return {retriever,assistant:createEvidenceAssistant(retriever,provider)};
}
// const configured=configureEvidence(hostApprovedConfiguration);
// try {const result=await configured.assistant.answer('How are snapshots persisted?',{signal});}
// finally {await configured.retriever.close();}
// Result is either insufficient (provider never called) or answered with validated citation IDs.
