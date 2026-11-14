import { Readable } from 'node:stream';
import { createCompressionOwner } from 'zhost/compression';
import { forwardPerformanceResponse } from '@zeruxjs/performance/response';
// One owner per application; do not also compress this response in another layer.
/** Application-owned hosting compression owner; one layer per response and explicit close. */
const compression = createCompressionOwner({
  encodings: ['br', 'gzip'],
  maxConcurrent: 4,
});
/** Forward one explicit public synthetic catalog through the sole borrowed hosting compression owner.
 * @param {import('node:http').IncomingMessage} request - Borrowed native request; host derives authentication before classification.
 * @param {import('node:http').ServerResponse} response - Borrowed native uncommitted response.
 * @returns {void} Delegates response ownership without starting a server or adding a second compression layer.
 */
export function handlePublicCatalog(request, response) {
  /** Explicit synthetic public response bytes, never a request-time minification pipeline. */
  const bytes = Buffer.from(JSON.stringify({ products: [] }));
  /** Owned synthetic response stream or emitted JavaScript being inspected, never untrusted executable input. */
  const source = Readable.from([bytes]);
  source.headers = {
    'content-type': 'application/json',
    'content-length': String(bytes.length),
    'cache-control': 'public, max-age=30',
  };
  // Real application handlers derive this classification after authorization.
  forwardPerformanceResponse(compression, request, source, response, {
    authenticated: false,
    public: true,
  });
}
/** Public application teardown callback delegating to its one owned compression coordinator.
 * @returns {Promise<void>} Settles after owned encoder/response cleanup.
 */
export const close = () => compression.close();
