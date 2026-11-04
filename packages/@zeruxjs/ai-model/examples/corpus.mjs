import { generateRepositoryCorpus, createCorpusReader } from '@zeruxjs/ai-model/corpus';
// Host invokes explicitly during a build/generation, not once per question.
export async function buildPublicCorpus(root,previous){
 return generateRepositoryCorpus({root,previous,packages:[{
  manifest:'packages/@zeruxjs/ai-model/package.json',
  exports:[{name:'.',source:'packages/@zeruxjs/ai-model/src/index.ts'},{name:'./corpus',source:'packages/@zeruxjs/ai-model/src/corpus.ts'}],
  docs:['packages/@zeruxjs/ai-model/README.md'],
 }]});
}
export function openCorpus(snapshot,verifiedPrincipal,expectedManifestHash,authorizeSource){
 return createCorpusReader(snapshot,{principal:verifiedPrincipal,expectedManifestHash,authorize:authorizeSource});
}
// const built=await buildPublicCorpus(projectRoot,previousValidatedSnapshot);
// await saveRepositoryCorpus(built.snapshot,hostPrivateOutputFile);
// const reader=openCorpus(built.snapshot,verifiedPrincipal,built.snapshot.sourceManifestHash,hostSourceAuthorizer);
// const evidence=reader.prepare('How are snapshots persisted?');
// Host may supply evidence.prompt to its explicitly configured @zeruxjs/ai provider.
// reader.close(); // no source rescanning, watchers or provider calls are started automatically
