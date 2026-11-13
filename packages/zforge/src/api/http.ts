export interface DevtoolsApiClientOptions {
  /** Trusted development server URL; do not derive it from arbitrary client input. */
  baseUrl: string;
  /** Explicit registered application namespace. */
  app: string;
  /** Trusted endpoint namespace; defaults to zdev. */
  serviceName?: string;
  /** Optional opaque pairing identifier, not authentication. */
  identifier?: string | null;
}

/** Construct a legacy API URL from explicit host settings.
 * @param {string} baseUrl - Trusted development server base URL.
 * @param {string} app - Registered application namespace.
 * @param {string} path - Authored relative API path.
 * @param {string | null} [identifier] - Optional pairing label.
 * @param {string} [serviceName] - Trusted endpoint namespace.
 * @returns {URL} API URL; this helper does not authorize its destination.
 */
const buildPath = (
  baseUrl: string,
  app: string,
  path: string,
  identifier?: string | null,
  serviceName = 'zdev'
) => {
  /** Explicit development endpoint URL with optional pairing/requester query metadata. */
  const url = new URL(
    `${baseUrl.replace(/\/$/, '')}/${app}/__${serviceName}/api/${path.replace(/^\//, '')}`
  );
  if (identifier) {
    url.searchParams.set('identifier', identifier);
  }
  return url;
};

/** Create an inert legacy JSON client using the host global Fetch implementation.
 * @param {DevtoolsApiClientOptions} options - Trusted server/application settings.
 * @returns {{get: (path: string) => Promise<unknown>}} Client facade; no connection or disposal owner is allocated on creation.
 */
export const createDevtoolsApiClient = ({
  baseUrl,
  app,
  identifier,
  serviceName,
}: DevtoolsApiClientOptions) => ({
  /** Fetch one authored development API path and decode its JSON response.
   * @param {string} path - Relative API handler path selected by trusted host code.
   * @returns {Promise<unknown>} Decoded JSON; this legacy helper adds no automatic status validation or retry.
   */
  async get(path: string) {
    /** Fetch response decoded as JSON; callers own failure handling and trust in the server. */
    const response = await fetch(
      buildPath(baseUrl, app, path, identifier, serviceName),
      {
        headers: { Accept: 'application/json' },
      }
    );
    return response.json();
  },
});

/** Create an inert client for explicitly named trusted module APIs.
 * @param {DevtoolsApiClientOptions & {moduleId: string, requesterModuleId?: string | null}} options - Host-selected module/application URL settings.
 * @returns {{request: (name: string, init?: object) => Promise<unknown>}} Legacy client without implicit retry, deadline or authentication guarantees.
 */
export const createDevtoolsModuleApiClient = (
  options: DevtoolsApiClientOptions & {
    /** Explicit configured module identifier. */
    moduleId: string;
    /** Optional declared caller-module label; host policy still controls access. */
    requesterModuleId?: string | null;
  }
) => ({
  /** Call a named module API with explicit method/body settings.
   * @param {string} name - Authored module API operation name.
   * @param {{ method?: string; body?: unknown }} init - Optional request method and JSON-serializable input.
   * @param {string} [init.method] - Explicit HTTP method, defaulting to POST.
   * @param {unknown} [init.body] - JSON-serializable input for receiver-side validation.
   * @returns {Promise<unknown>} Decoded JSON; the server remains authoritative for authorization and validation.
   */
  async request(
    name: string,
    init?: {
      /** Explicit native request method; defaults to POST. */
      method?: string;
      /** JSON input validated by the receiving trusted handler. */
      body?: unknown;
    }
  ) {
    /** Trusted service namespace, defaulting to the legacy zdev endpoint prefix. */
    const service = options.serviceName || 'zdev';
    /** Explicit development endpoint URL with optional pairing/requester query metadata. */
    const url = new URL(
      `${options.baseUrl.replace(/\/$/, '')}/${options.app}/__${service}/modules/${options.moduleId}/api/${name.replace(/^\//, '')}`
    );
    if (options.identifier) {
      url.searchParams.set('identifier', options.identifier);
    }
    if (options.requesterModuleId) {
      url.searchParams.set('requester', options.requesterModuleId);
    }

    /** Explicit request method; GET and HEAD deliberately carry no JSON body. */
    const method = init?.method ?? 'POST';
    /** Fetch response decoded as JSON; callers own failure handling and trust in the server. */
    const response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body:
        method === 'GET' || method === 'HEAD'
          ? undefined
          : JSON.stringify(init?.body ?? {}),
    });
    return response.json();
  },
});
