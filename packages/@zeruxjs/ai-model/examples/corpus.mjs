import {
  generateRepositoryCorpus,
  createCorpusReader,
} from '@zeruxjs/ai-model/corpus';
// Host invokes explicitly during a build/generation, not once per question.
/**
 * Generate only explicitly approved public package sources during a trusted local build.
 * @param {string} root - Stable trusted checkout root; Git ignore checks must be available.
 * @param {import('@zeruxjs/ai-model/corpus').CorpusSnapshot | undefined} previous - Optional validated prior candidate for chunk reuse.
 * @returns {ReturnType<typeof generateRepositoryCorpus>} Validated candidate and change receipt; no snapshot is persisted automatically.
 */
export async function buildPublicCorpus(root, previous) {
  return generateRepositoryCorpus({
    root,
    previous,
    packages: [
      {
        manifest: 'packages/@zeruxjs/ai-model/package.json',
        exports: [
          { name: '.', source: 'packages/@zeruxjs/ai-model/src/index.ts' },
          {
            name: './corpus',
            source: 'packages/@zeruxjs/ai-model/src/corpus.ts',
          },
        ],
        docs: ['packages/@zeruxjs/ai-model/README.md'],
      },
    ],
  });
}
/**
 * Open a copied corpus view using current host identity, source approval and trusted hash.
 * @param {import('@zeruxjs/ai-model/corpus').CorpusSnapshot} snapshot - Complete validated candidate.
 * @param {Readonly<import('@zeruxjs/ai-model/corpus').CorpusPrincipal>} verifiedPrincipal - Server-verified initiating tenant/subject.
 * @param {string} expectedManifestHash - Current successful generation identity from trusted host state.
 * @param {(principal: Readonly<import('@zeruxjs/ai-model/corpus').CorpusPrincipal>, source: Readonly<import('@zeruxjs/ai-model/corpus').CorpusSource>) => boolean} authorizeSource - Synchronous host permission check, reexecuted for each prepare.
 * @returns {ReturnType<import('@zeruxjs/ai-model/corpus').createCorpusReader>} Reader the caller must close; no provider call or source rescan occurs.
 */
export function openCorpus(
  snapshot,
  verifiedPrincipal,
  expectedManifestHash,
  authorizeSource
) {
  return createCorpusReader(snapshot, {
    principal: verifiedPrincipal,
    expectedManifestHash,
    authorize: authorizeSource,
  });
}
// const built=await buildPublicCorpus(projectRoot,previousValidatedSnapshot);
// await saveRepositoryCorpus(built.snapshot,hostPrivateOutputFile);
// const reader=openCorpus(built.snapshot,verifiedPrincipal,built.snapshot.sourceManifestHash,hostSourceAuthorizer);
// const evidence=reader.prepare('How are snapshots persisted?');
// Host may supply evidence.prompt to its explicitly configured @zeruxjs/ai provider.
// reader.close(); // no source rescanning, watchers or provider calls are started automatically
