/** Historical standalone policy experiment, excluded from src builds and package exports.
 * Importing/running this scratch file logs its demonstration policy; maintained code
 * uses createDevtoolsDocumentPolicy with explicit trusted host framing grants.
 */
import { IncomingMessage } from 'node:http';
import crypto from 'node:crypto';

/** Create a nonce only for this standalone historical experiment.
 * @param {number} [size] - Random byte count.
 * @returns {string} Base64 bytes; this is not the maintained response policy API.
 */
const createNonce = (size = 16) => crypto.randomBytes(size).toString('base64');

/** Parse a historical candidate origin without granting trust.
 * @param {string | null} [value] - Experimental input string.
 * @returns {string | null} HTTP(S) origin or null; parsing alone is never authorization.
 */
const normalizeAncestorOrigin = (value?: string | null) => {
  if (!value) {
    return null;
  }
  try {
    /** Parsed candidate origin retained only by this unexported experiment. */
    const origin = new URL(value).origin;
    if (origin.startsWith('http://') || origin.startsWith('https://')) {
      return origin;
    }
  } catch {
    return null;
  }
  return null;
};

/** Build historical broad ancestor candidates for the standalone scratch demonstration.
 * @param {IncomingMessage} [req] - Synthetic request; header-derived candidates are not trusted policy.
 * @param {unknown} [registration] - Historical experimental registration.
 * @returns {string[]} Experimental candidates; maintained runtime uses explicit createDevtoolsDocumentPolicy instead.
 */
const getFrameAncestors = (req?: IncomingMessage, registration: any = null) => {
  /** Historical localhost candidate list, not the published framing contract. */
  const localIPs = ['localhost', '127.0.0.1'];

  /** Historical broad development patterns; never reuse these as authenticated host grants. */
  const localWildCardIPs = [
    'http://*.localhost',
    'https://*.localhost',
    'http://10.*',
    'https://10.*',
    'http://192.168.*',
    'https://192.168.*',
    'http://172.16.*',
    'https://172.16.*',
  ];
  /** Standalone experimental candidate set, separate from maintained exact-origin policy. */
  const ancestors = new Set<string>(["'self'", ...localWildCardIPs]);

  for (const host of localIPs) {
    ancestors.add(`http://${host}`);
    ancestors.add(`https://${host}`);
  }

  /** Historical optional application port used only to demonstrate candidate formatting. */
  const appPort = registration?.appPort;
  if (appPort) {
    for (const host of localIPs) {
      ancestors.add(`http://${host}:${appPort}`);
      ancestors.add(`https://${host}:${appPort}`);
    }
  }

  if (registration) {
    /** Historical registration candidates; they do not authenticate an embedding parent. */
    const { allowedDevDomain, allowedDomains } = registration;

    if (allowedDevDomain) {
      ancestors.add(`http://${allowedDevDomain}`);
      ancestors.add(`https://${allowedDevDomain}`);
    }

    /** Normalized historical candidate list for this standalone output. */
    const domains = Array.isArray(allowedDomains)
      ? allowedDomains
      : [allowedDomains];
    for (const domain of domains) {
      if (domain) {
        ancestors.add(`http://${domain}`);
        ancestors.add(`https://${domain}`);
      }
    }
  }

  /** Header-derived experimental candidate; the maintained runtime does not trust it for framing. */
  const requestOrigin = normalizeAncestorOrigin(
    String(req?.headers.origin || '')
  );
  /** Header-derived experimental candidate; the maintained runtime does not trust it for framing. */
  const refererOrigin = normalizeAncestorOrigin(
    String(req?.headers.referer || '')
  );
  if (requestOrigin) {
    ancestors.add(requestOrigin);
  }
  if (refererOrigin) {
    ancestors.add(refererOrigin);
  }

  return [...ancestors];
};

/** Serialize the historical demonstration policy only.
 * @param {string} nonce - Synthetic nonce.
 * @param {{frameAncestors?: string[]}} [options] - Historical unreviewed ancestor candidates.
 * @param {string[]} [options.frameAncestors] - Historical unreviewed candidates, not supported runtime framing grants.
 * @returns {string} Scratch policy string, not a supported security composer.
 */
const buildContentSecurityPolicy = (
  nonce: string,
  options?: { frameAncestors?: string[] }
) => {
  /** Historical joined candidate expression, outside the published response policy API. */
  const frameAncestors = options?.frameAncestors?.length
    ? options.frameAncestors.join(' ')
    : "'self'";

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss: http: https:",
    `frame-ancestors ${frameAncestors}`,
    "base-uri 'self'",
    "object-src 'none'",
  ].join('; ');
};

/** Demonstrate the historical header-derived framing experiment.
 * @param {string} nonce - Synthetic nonce.
 * @param {IncomingMessage} [req] - Synthetic native-shaped request.
 * @param {unknown} [registration] - Historical optional registration.
 * @returns {string} Logged experimental policy; do not install it in an application.
 */
const buildFrameAwarePolicy = (
  nonce: string,
  req?: IncomingMessage,
  registration: any = null
) => {
  console.log(getFrameAncestors(req, registration).join(' '));
  // return ['self'].join(' ');
  return buildContentSecurityPolicy(nonce).replace(
    "frame-ancestors 'self'",
    `frame-ancestors ${getFrameAncestors(req, registration).join(' ')}`
  );
};

/** One synthetic random value used only if this unexported scratch file is executed manually. */
const nonce = createNonce();
console.log(
  buildFrameAwarePolicy(nonce, {
    headers: {
      origin: 'http://localhost:3000',
      referer: 'http://localhost:3000',
    },
  } as any)
);
