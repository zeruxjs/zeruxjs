import {
  createEvidenceRetriever,
  createEvidenceAssistant,
} from '@zeruxjs/ai-model/evidence';
// Snapshot/hash come from the current successful corpus build, identity/permissions from host auth.
/**
 * Configure authorized bounded lexical evidence and a borrowed citation-checking provider.
 * @param {object} options - Host-verified corpus identity and explicit provider/permission policy.
 * @param {import('@zeruxjs/ai-model/corpus').CorpusSnapshot} options.snapshot - Complete current corpus.
 * @param {string} options.expectedManifestHash - Trusted current successful source generation hash.
 * @param {Readonly<import('@zeruxjs/ai-model/corpus').CorpusPrincipal>} options.principal - Verified initiating tenant/subject, never a query role claim.
 * @param {import('@zeruxjs/ai-model/evidence').EvidenceRetrieverOptions['authorize']} options.authorize - Current synchronous source policy.
 * @param {import('@zeruxjs/ai-model').GroundedChatProvider} options.provider - Borrowed authorized structural provider; no SDK is loaded here.
 * @returns {{retriever: ReturnType<typeof createEvidenceRetriever>, assistant: ReturnType<typeof createEvidenceAssistant>}} Retriever plus assistant; caller must await retriever.close on teardown.
 */
export function configureEvidence({
  snapshot,
  expectedManifestHash,
  principal,
  authorize,
  provider,
}) {
  /** Caller-owned scoped retriever; dispose it at request/generation teardown after actual adapter settlement. */
  const retriever = createEvidenceRetriever(snapshot, {
    expectedManifestHash,
    principal,
    authorize,
    ranking: {
      weights: { title: 8, text: 1, symbols: 4 },
      normalization: 'NFKC',
      foldDiacritics: true,
    },
    maxTokens: 4096,
    maxCharacters: 16000,
    minSources: 1,
  });
  return { retriever, assistant: createEvidenceAssistant(retriever, provider) };
}
// const configured=configureEvidence(hostApprovedConfiguration);
// try {const result=await configured.assistant.answer('How are snapshots persisted?',{signal});}
// finally {await configured.retriever.close();}
// Result is either insufficient (provider never called) or answered with validated citation IDs.
