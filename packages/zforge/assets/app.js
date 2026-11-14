/** Host-authored development bootstrap; this page-lifetime client is not a general untrusted script loader. */
const { config = {}, bootstrap: initialBootstrap = null } = window.zdev || {};
/** Local-only legacy theme preference key; storage ownership remains with the current page. */
const themeStorageKey = 'zdev:devtools:theme';
/** Fixed theme cycle supported by the authored native toggle. */
const themeModes = ['system', 'dark', 'light'];
let forcedThemeMode = null;
/** Page-lifetime mounted panel callbacks; legacy code exposes no aggregate disposal API. */
const moduleMounts = new Map();
/** Page-local import promise cache for explicitly configured trusted module assets. */
const loadedScripts = new Map();
/** Page-local stylesheet fetch promise cache for explicitly configured module assets. */
const loadedStyles = new Map();

/** Load only explicit host-configured module assets in the development browser.
 * @param {object} moduleData - Trusted server module descriptor.
 * @returns {Promise<object | null>} Style text and executed trusted module namespace; no arbitrary user code strings are accepted.
 */
const loadModuleAssets = async (moduleData) => {
  if (!moduleData.assets) {
    return null;
  }

  /** Explicit module asset references emitted by the host package loader. */
  const { styleUrl, scriptUrl } = moduleData.assets;
  /** Resolved trusted module assets accumulated for this mount. */
  const results = {};

  if (styleUrl) {
    if (!loadedStyles.has(styleUrl)) {
      loadedStyles.set(
        styleUrl,
        (async () => {
          /** Native asset/bootstrap/API response decoded only by this controlled development client. */
          const response = await fetch(styleUrl, { cache: 'default' });
          if (!response.ok) {
            throw new Error('Failed to load style');
          }
          return response.text();
        })()
      );
    }
    results.style = await loadedStyles.get(styleUrl);
  }

  if (scriptUrl) {
    if (!loadedScripts.has(scriptUrl)) {
      loadedScripts.set(
        scriptUrl,
        import(new URL(scriptUrl, window.location.origin).toString())
      );
    }
    results.script = await loadedScripts.get(scriptUrl);
  }

  return results;
};

/** Warm explicitly configured module assets without mounting their panels.
 * @param {object[]} modules - Host-authored module descriptors.
 * @param {string} skipId - Current module/section excluded from speculative loading.
 * @returns {void} Starts legacy page-local preload promises; no cleanup handle is returned.
 */
const preloadModules = (modules, skipId) => {
  modules.forEach((module) => {
    if (
      module.id === skipId ||
      (module.sections && module.sections.some((s) => s.id === skipId))
    ) {
      return;
    }
    if (module.assets) {
      void loadModuleAssets(module);
    }
  });
};

/** Mutable page state; its object identity remains stable through snapshot and socket updates. */
const applicationState = {
  app: config.app?.routeName || null,
  identifier: config.identifier || null,
  sectionId: config.sectionId || null,
  bootstrap: initialBootstrap,
  socket: null,
  devtoolsSocket: null,
};

/** Encode inert display text for the generated client HTML fragments.
 * @param {unknown} value - Public display value.
 * @returns {string} HTML text/quoted-attribute encoding; not JavaScript or URL authorization.
 */
const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Read native color preference without storing an identity.
 * @returns {string} Dark or light mode supported by the current browser.
 */
const getSystemTheme = () =>
  window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';

/** Apply the selected theme using native attributes and inert text.
 * @param {string} mode - Explicit theme mode under the existing preference policy.
 * @returns {void} Updates the root and optional native toggle label.
 */
const applyTheme = (mode) => {
  /** Resolved explicit forced/system theme for this render. */
  const effective = (() => {
    if (forcedThemeMode === 'dark' || forcedThemeMode === 'light') {
      return forcedThemeMode;
    }
    if (mode === 'system') {
      return getSystemTheme();
    }
    return mode;
  })();
  document.documentElement.setAttribute('data-theme', effective);
  /** Optional authored native theme label node. */
  const label = document.querySelector('[data-theme-label]');
  if (label) {
    label.textContent = `Theme: ${mode[0].toUpperCase()}${mode.slice(1)}`;
  }
};

/** Read the page theme preference from local storage.
 * @returns {string} Stored legacy mode or system fallback; no remote collection occurs.
 */
const getSavedTheme = () => localStorage.getItem(themeStorageKey) || 'system';

/** Exact same-origin/host-configured parent origins; wildcard targets are never derived from messages. */
const themeParentOrigins = new Set([
  window.location.origin,
  ...(config.themeParentOrigins || []).filter((value) => {
    try {
      /** Explicit local/configured URL used for its current authored endpoint or parent-origin check. */
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
    } catch {
      return false;
    }
  }),
]);
/** Send only theme state to the exact approved parent origins.
 * @param {string} mode - Current explicit theme mode.
 * @returns {void} Does nothing for a top-level window; no wildcard target is used.
 */
const broadcastThemeToParent = (mode) => {
  if (window.parent === window) {
    return;
  }
  for (const origin of themeParentOrigins) {
    window.parent.postMessage(
      {
        type: 'zdev:theme-sync',
        mode,
        effectiveTheme: mode === 'system' ? getSystemTheme() : mode,
      },
      origin
    );
  }
};

/** Install page-lifetime native theme, storage and exact-parent listeners.
 * @returns {void} Registers the legacy client behavior; page teardown owns its listener lifetime.
 */
const setupThemeToggle = () => {
  let mode = getSavedTheme();
  applyTheme(mode);
  document
    .querySelector('[data-theme-toggle]')
    ?.addEventListener('click', () => {
      /** Current mode position before advancing through the fixed supported cycle. */
      const currentIndex = themeModes.indexOf(mode);
      mode = themeModes[(currentIndex + 1) % themeModes.length];
      localStorage.setItem(themeStorageKey, mode);
      forcedThemeMode = null;
      applyTheme(mode);
      broadcastThemeToParent(mode);
    });
  window
    .matchMedia?.('(prefers-color-scheme: dark)')
    ?.addEventListener?.('change', () => {
      if (mode === 'system') {
        applyTheme(mode);
        broadcastThemeToParent(mode);
      }
    });
  window.addEventListener('storage', (event) => {
    if (event.key === themeStorageKey) {
      mode = getSavedTheme();
      forcedThemeMode = null;
      applyTheme(mode);
      broadcastThemeToParent(mode);
    }
  });
  window.addEventListener('message', (event) => {
    if (
      event.source !== window.parent ||
      !themeParentOrigins.has(event.origin) ||
      !event.data ||
      event.data.type !== 'zdev:theme-sync'
    ) {
      return;
    }
    /** Candidate parent mode accepted only by the explicit system/dark/light branch. */
    const nextMode = event.data.mode;
    /** Candidate parent effective mode restricted to explicit dark/light values. */
    const nextEffectiveTheme = event.data.effectiveTheme;
    if (nextMode === 'system' || nextMode === 'dark' || nextMode === 'light') {
      mode = nextMode;
      localStorage.setItem(themeStorageKey, nextMode);
    }
    forcedThemeMode =
      nextEffectiveTheme === 'dark' || nextEffectiveTheme === 'light'
        ? nextEffectiveTheme
        : null;
    applyTheme(mode);
  });
  broadcastThemeToParent(mode);
};

/** Project host snapshot labels through native textContent updates.
 * @param {object} snapshot - Host-approved private development view.
 * @param {object[]} modules - Explicit module descriptors.
 * @returns {void} Updates only existing overview nodes.
 */
const renderOverview = (snapshot, modules) => {
  /** Existing authored overview/module node selected before native text or fragment updates. */
  const root = document.querySelector('[data-overview-root]');
  if (root) {
    root.textContent = snapshot.rootDir || 'unknown';
  }
  /** Existing manifest-path display node; no file is fetched through this label. */
  const manifest = document.querySelector('[data-overview-manifest]');
  if (manifest) {
    manifest.textContent = snapshot.manifestPath || 'missing';
  }
  /** Existing log-path display node; path text is not executed. */
  const log = document.querySelector('[data-overview-log]');
  if (log) {
    log.textContent = snapshot.logFilePath || 'missing';
  }
  /** Existing snapshot timestamp display node. */
  const updated = document.querySelector('[data-overview-updated]');
  if (updated) {
    updated.textContent = snapshot.updatedAt || 'unknown';
  }
  /** Existing application-port display node. */
  const port = document.querySelector('[data-overview-port]');
  if (port) {
    port.textContent = String(snapshot.appPort ?? 'unknown');
  }
  /** Existing runtime-mode display node. */
  const mode = document.querySelector('[data-overview-mode]');
  if (mode) {
    mode.textContent = snapshot.mode || 'unknown';
  }
  /** Existing route-count display node. */
  const routes = document.querySelector('[data-overview-routes]');
  if (routes) {
    routes.textContent = String((snapshot.routes || []).length);
  }
  /** Existing module-count metric node. */
  const moduleCount = document.querySelector('[data-overview-modules]');
  if (moduleCount) {
    moduleCount.textContent = String(modules.length);
  }
  /** Existing configured-module detail node. */
  const moduleCountDetail = document.querySelector(
    '[data-overview-module-count]'
  );
  if (moduleCountDetail) {
    moduleCountDetail.textContent = `${modules.length} active`;
  }
};

/** Render escaped route display fields into the authored list container.
 * @param {object} snapshot - Host-approved route summary.
 * @returns {void} Replaces only the existing route-list fragment.
 */
const renderPages = (snapshot) => {
  /** Existing authored page-list container. */
  const list = document.querySelector('[data-pages-list]');
  if (!list) {
    return;
  }
  list.innerHTML = (snapshot.routes || []).length
    ? snapshot.routes
        .map(
          (route) => `
      <div class="zdev-route-item">
        <strong>${escapeHtml(route.path)}</strong>
        <span>${escapeHtml((route.methods || []).join(', '))}</span>
      </div>
    `
        )
        .join('')
    : `<p class="zdev-empty">No routes found.</p>`;
};

/** Render escaped inert module summaries into the authored containers.
 * @param {object[]} modules - Explicit host-configured module metadata.
 * @returns {void} Updates only module list/summary display fragments.
 */
const renderModules = (modules) => {
  /** Existing authored overview/module node selected before native text or fragment updates. */
  const root = document.querySelector('[data-modules-list]');
  if (root) {
    root.innerHTML = modules.length
      ? modules
          .map(
            (module) => `
        <article class="zdev-module-card">
          <strong>${escapeHtml(module.title)}</strong>
          <span>${escapeHtml(module.description || 'No description provided.')}</span>
          <small>${escapeHtml(module.packageName || module.badge || 'custom module')}</small>
        </article>
      `
          )
          .join('')
      : `<p class="zdev-empty">No registered devtools modules.</p>`;
  }

  /** Existing authored module-summary container. */
  const summary = document.querySelector('[data-module-summary]');
  if (summary) {
    summary.innerHTML = modules.length
      ? modules
          .map(
            (module) => `
          <article class="zdev-module-item">
            <strong>${escapeHtml(module.title)}</strong>
            <span>${escapeHtml(module.badge || 'registered')}</span>
          </article>
        `
          )
          .join('')
      : `<p class="zdev-empty">No extra modules registered.</p>`;
  }
};

/** Display escaped event text and raw log text in controlled development nodes.
 * @param {object} snapshot - Host-approved bounded server snapshot.
 * @returns {void} Updates existing diagnostics containers without executing event data.
 */
const renderDiagnostics = (snapshot) => {
  /** Existing client-event display container; dynamic values are HTML encoded. */
  const events = document.getElementById('events');
  if (events) {
    events.innerHTML = (snapshot.clientEvents || []).length
      ? snapshot.clientEvents
          .slice()
          .reverse()
          .map((event) => {
            /** Fixed event severity display class selected from the authored mapping. */
            const css = (() => {
              if (event.type === 'error') {
                return 'event-error';
              }
              if (event.type === 'warn') {
                return 'event-warn';
              }
              return 'event-info';
            })();
            return `<code class="${css}">[${escapeHtml(event.type || 'info')}] ${escapeHtml(event.message || JSON.stringify(event))}</code>`;
          })
          .join('')
      : `<div class="zdev-empty">No client events yet.</div>`;
  }
  /** Existing log display node populated through textContent. */
  const logs = document.getElementById('logs');
  if (logs) {
    logs.textContent = (snapshot.logs || []).join('\n') || 'No logs yet.';
  }
};

/** Call an explicitly named trusted legacy module API on this development origin.
 * @param {string} moduleId - Configured module routing label.
 * @param {string} name - Authored operation key.
 * @param {object} [options] - Explicit method/body/requester labels.
 * @returns {Promise<unknown>} Decoded JSON; server authentication and validation remain authoritative.
 */
const callModuleApi = async (moduleId, name, options = {}) => {
  /** Explicit local/configured URL used for its current authored endpoint or parent-origin check. */
  const url = new URL(
    `/${applicationState.app}/__${window.zdev.service}/modules/${moduleId}/api/${name}`,
    window.location.origin
  );
  if (applicationState.identifier) {
    url.searchParams.set('identifier', applicationState.identifier);
  }
  if (options.requester) {
    url.searchParams.set('requester', options.requester);
  } else {
    url.searchParams.set('requester', moduleId);
  }
  /** Explicit legacy request method; GET/HEAD do not carry a JSON body. */
  const method = options.method || 'POST';
  /** Native asset/bootstrap/API response decoded only by this controlled development client. */
  const response = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
    body:
      method === 'GET' || method === 'HEAD'
        ? undefined
        : JSON.stringify(options.body ?? {}),
  });
  return response.json();
};

/** Bind a trusted panel caller label without granting authorization.
 * @param {string} moduleId - Configured caller module.
 * @returns {Function} Inert API facade forwarding only to the same development origin.
 */
const createModuleApi =
  (moduleId) =>
  (name, options = {}) =>
    callModuleApi(moduleId, name, { ...options, requester: moduleId });

window.zdev.api = callModuleApi;

/** Open one native socket for the current controlled development page.
 * @returns {WebSocket} Page-owned socket; this legacy client has no exported teardown facade.
 */
const createDevtoolsSocket = () => {
  /** WSS only when the current development page origin uses HTTPS. */
  const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  /** Native socket URL confined to the current development page authority. */
  const wsUrl = new URL(
    `${wsProtocol}//${location.host}/__${window.zdev.service}/ws`
  );
  wsUrl.searchParams.set('app', applicationState.app);
  wsUrl.searchParams.set('client', 'devtools');
  if (applicationState.identifier) {
    wsUrl.searchParams.set('identifier', applicationState.identifier);
  }
  return new WebSocket(wsUrl.toString());
};

/** Borrow the page socket for explicitly declared module channel envelopes.
 * @param {string} moduleId - Trusted configured module label.
 * @returns {object} Borrowed facade; close intentionally does not close the shared page socket.
 */
const createModuleSocket = (moduleId) => {
  /** Current page-owned shared socket borrowed by module facades and update listeners. */
  const socket = applicationState.devtoolsSocket;

  return {
    raw: socket,
    /** Send a declared module server-channel envelope over the borrowed open page socket.
     * @param {string} channel - Explicit registered server channel key.
     * @param {object} payload - Receiver-validated structured input.
     * @returns {void} No-op when the page socket is unavailable; no acknowledgement guarantee is added.
     */
    requestServer(channel, payload) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      socket.send(
        JSON.stringify({
          type: 'channel',
          channelType: 'server',
          app: applicationState.app,
          moduleId,
          requesterModuleId: moduleId,
          channel,
          identifier: applicationState.identifier || undefined,
          payload: payload || {},
        })
      );
    },
    /** Forward a declared peer-channel envelope without granting target access.
     * @param {string} channel - Explicit peer channel key.
     * @param {object} payload - Receiver-validated structured input.
     * @param {string} targetModuleId - Explicit configured peer destination.
     * @returns {void} No-op when the borrowed page socket is unavailable.
     */
    sendPeer(channel, payload, targetModuleId) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      socket.send(
        JSON.stringify({
          type: 'channel',
          channelType: 'peer',
          app: applicationState.app,
          moduleId,
          targetModuleId,
          requesterModuleId: moduleId,
          channel,
          identifier: applicationState.identifier || undefined,
          payload: payload || {},
        })
      );
    },
    /** Install a page-lifetime listener filtered by the declared module label.
     * @param {Function} handler - Trusted module callback validating its own structured payload.
     * @returns {void} Registers a legacy listener; this facade exposes no individual unsubscribe handle.
     */
    onMessage(handler) {
      socket?.addEventListener('message', (event) => {
        try {
          /** Parsed native message whose module label is checked before a trusted callback receives it. */
          const message = JSON.parse(String(event.data));
          if (message.moduleId && message.moduleId !== moduleId) {
            return;
          }
          handler(message);
        } catch {
          return;
        }
      });
    },
    /** Leave the borrowed shared page socket owned by its page integration.
     * @returns {void} Intentional no-op; this module facade does not own the native socket.
     */
    close() {
      return;
    },
  };
};

/** Mount one explicit trusted module into its authored shadow-root panel.
 * @param {Element} panel - Authored panel carrying a trusted module reference.
 * @param {object} moduleData - Host-selected executable module descriptor.
 * @returns {Promise<void>} Mount settlement; lifecycle callbacks remain page-owned in the legacy mount map.
 */
const mountModulePanel = async (panel, moduleData) => {
  if (!moduleData || moduleMounts.has(panel)) {
    return;
  }

  /** Authored module root; shadow DOM scopes styles, not execution permissions. */
  const host = panel.querySelector('[data-module-root]');
  /** Trusted server-authored module template, not sanitized arbitrary request HTML. */
  const template = host?.querySelector('template');
  if (!host || !template) {
    return;
  }

  /** Owned module presentation root; this is not a code sandbox. */
  const shadowRoot = host.attachShadow({ mode: 'open' });
  /** Authored surface receiving a cloned trusted module template. */
  const wrapper = document.createElement('div');
  wrapper.className = 'zdev-module-surface';

  /** Fixed module surface styles installed within the presentation root. */
  const baseStyle = document.createElement('style');
  baseStyle.textContent = `
    :host { color: inherit; }
    *, *::before, *::after { box-sizing: border-box; }
    .zdev-module-surface { color: inherit; font: inherit; }
  `;
  shadowRoot.append(baseStyle, wrapper);
  wrapper.append(template.content.cloneNode(true));

  let lifecycle = null;
  /** Resolved explicit module stylesheet and trusted browser namespace. */
  const assets = await loadModuleAssets(moduleData);

  if (assets?.style) {
    /** Scoped style node populated from the explicitly configured local module asset. */
    const style = document.createElement('style');
    style.textContent = assets.style;
    shadowRoot.prepend(style);
  }

  /** Explicitly configured trusted module namespace; code is not selected from message payloads. */
  const mod = assets?.script;
  if (mod) {
    /** Recognized trusted mount callback invoked only after explicit host module selection. */
    const mount = mod.mount || mod.default?.mount;
    if (typeof mount === 'function') {
      lifecycle = await mount({
        app: config.app,
        identifier: config.identifier || null,
        snapshot: applicationState.bootstrap?.snapshot || {},
        module: moduleData,
        root: wrapper,
        shadowRoot,
        api: createModuleApi(moduleData.id),
        socket: createModuleSocket(moduleData.id),
      });
    }
  }

  moduleMounts.set(panel, {
    /** Forward approved refreshed state to the trusted mounted module callback.
     * @param {object} nextState - Current host bootstrap state.
     * @returns {void} Invokes only the explicitly mounted module lifecycle callback.
     */
    refresh(nextState) {
      lifecycle?.refresh?.(nextState);
    },
    /** Invoke only the trusted mounted module cleanup callbacks.
     * @returns {void} Requests module cleanup; the legacy page has no aggregate mount-map disposal entry.
     */
    destroy() {
      lifecycle?.destroy?.();
      lifecycle?.socket?.close?.();
    },
  });
};

/** Update authored section navigation and mount its configured module panel.
 * @param {string} id - Authored section identifier.
 * @param {boolean} [skipHistory] - Whether history already selected the section.
 * @returns {Promise<void>} Active panel mount settlement; visibility is not authorization.
 */
const setActiveSection = async (id, skipHistory = false) => {
  if (!skipHistory) {
    /** Explicit local/configured URL used for its current authored endpoint or parent-origin check. */
    const url = new URL(window.location.href);
    url.pathname = `/${applicationState.app}/${id === 'overview' ? '' : id}`;
    if (applicationState.identifier) {
      url.searchParams.set('identifier', applicationState.identifier);
    }
    window.history.pushState({ sectionId: id }, '', url.toString());
  }

  applicationState.sectionId = id;
  document.querySelectorAll('[data-section-link]').forEach((link) => {
    link.classList.toggle(
      'is-active',
      link.getAttribute('data-section-link') === id
    );
  });

  /** Explicit host module metadata retained across private snapshot refreshes. */
  const modules = applicationState.bootstrap?.modules || config.modules || [];
  /** Page-local configured module lookup used for authored panel activation. */
  const moduleMap = new Map(modules.map((module) => [module.id, module]));

  for (const panel of document.querySelectorAll('[data-section-panel]')) {
    /** Whether this authored panel matches the selected section identifier. */
    const isActive = panel.getAttribute('data-section-panel') === id;
    panel.classList.toggle('is-active', isActive);
    if (!isActive) {
      continue;
    }

    /** Configured module label attached to the active authored panel. */
    const moduleId = panel.getAttribute('data-module-panel');
    if (moduleId) {
      await mountModulePanel(panel, moduleMap.get(moduleId));
    }
  }
};

/** Install page-lifetime native section and mobile-sidebar controls.
 * @param {object[]} sections - Authored ordered section descriptors.
 * @returns {void} Registers existing page/history listeners without an exported disposal API.
 */
const setupSectionNavigation = (sections) => {
  /** Existing authored development application shell. */
  const shell = document.querySelector('.zdev-app-shell');
  /** Close only the native mobile sidebar state.
   * @returns {void} Removes the authored sidebar-open class if the shell exists.
   */
  const closeSidebar = () => shell?.classList.remove('is-sidebar-open');
  document.querySelectorAll('[data-section-link]').forEach((link) => {
    link.addEventListener('click', async () => {
      /** Authored section identifier read from a known control or history receipt. */
      const id = link.getAttribute('data-section-link');
      if (!id) {
        return;
      }
      if (window.innerWidth <= 750) {
        closeSidebar();
      }
      await setActiveSection(id);
    });
  });
  /** Configured initial section, otherwise the first explicitly authored section. */
  const initialId = config.sectionId || sections[0]?.id;
  if (initialId) {
    void setActiveSection(initialId, true);
  }

  window.addEventListener('popstate', (event) => {
    /** Authored section identifier read from a known control or history receipt. */
    const id = event.state?.sectionId || config.sectionId || sections[0]?.id;
    if (id) {
      void setActiveSection(id, true);
    }
  });
  document
    .querySelector('[data-sidebar-close]')
    ?.addEventListener('click', closeSidebar);
  document.addEventListener('click', (event) => {
    if (window.innerWidth > 750) {
      return;
    }
    if (!shell?.classList.contains('is-sidebar-open')) {
      return;
    }
    /** Existing authored mobile sidebar container. */
    const sidebar = document.querySelector('[data-sidebar]');
    /** Existing authored native sidebar toggle. */
    const toggle = document.querySelector('[data-sidebar-toggle]');
    /** Native click target checked as a Node before containment comparisons. */
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (sidebar?.contains(target) || toggle?.contains(target)) {
      return;
    }
    closeSidebar();
  });
};

/** Initialize the controlled legacy app view and its native update socket.
 * @returns {Promise<void>} Initial refresh/socket setup; reconnect uses existing page-lifetime state, not a generation-scoped disposal contract.
 */
const setupApplication = async () => {
  /** Explicit configured application namespace; absence leaves the application client inert. */
  const app = config.app?.routeName;
  if (!app) {
    return;
  }

  applicationState.app = app;
  applicationState.identifier = config.identifier || null;

  /** Fixed same-origin registered application bootstrap endpoint. */
  const bootstrapUrl = new URL(
    `/${app}/__${window.zdev.service}/api/bootstrap`,
    window.location.origin
  );
  if (applicationState.identifier) {
    bootstrapUrl.searchParams.set('identifier', applicationState.identifier);
  }

  /** Fetch the private development snapshot and update authored display nodes.
   * @returns {Promise<void>} Refresh settlement; trusted static module metadata remains available between snapshots.
   */
  const refresh = async () => {
    /** Native asset/bootstrap/API response decoded only by this controlled development client. */
    const response = await fetch(bootstrapUrl, { cache: 'no-store' });
    /** Decoded host bootstrap response or retained bootstrap data, never evaluated as code. */
    const data = await response.json();

    // Merge only updated info (snapshot, identifier) into the bootstrap state
    // to preserve static config like modules and sections metadata.
    applicationState.bootstrap = {
      ...(applicationState.bootstrap || {}),
      ...data,
      snapshot: {
        ...(applicationState.bootstrap?.snapshot || {}),
        ...(data.snapshot || {}),
      },
    };

    // Sync with global window object
    window.zdev.bootstrap = applicationState.bootstrap;

    /** Current private snapshot and explicit configured modules after the native refresh. */
    const { snapshot, modules = [] } = applicationState.bootstrap;
    renderOverview(snapshot, modules);
    renderPages(snapshot);
    renderModules(modules);
    renderDiagnostics(snapshot);

    for (const mount of moduleMounts.values()) {
      mount.refresh?.(applicationState.bootstrap);
    }
    if (modules.length) {
      preloadModules(modules, applicationState.sectionId);
    }
  };

  if (!applicationState.bootstrap) {
    applicationState.bootstrap = { ...config };
    window.zdev.bootstrap = applicationState.bootstrap;
  }

  setupSectionNavigation(config.sections || []);
  renderModules(config.modules || []);
  if (config.snapshot) {
    renderOverview(config.snapshot, config.modules || []);
  }

  if (config.modules) {
    /** Configured initial section, otherwise the first explicitly authored section. */
    const initialId =
      config.sectionId || (config.sections && config.sections[0]?.id);
    preloadModules(config.modules, initialId);
  }
  document
    .querySelector('[data-sidebar-toggle]')
    ?.addEventListener('click', () => {
      document
        .querySelector('.zdev-app-shell')
        ?.classList.toggle('is-sidebar-open');
    });

  if (applicationState.bootstrap.snapshot) {
    // Initial snapshot present (if we had it in inject, which we don't for now, but good for future)
    // or we just initialized it from config.
    // If we only have config, we still need one refresh for the snapshot.
    /** Decoded host bootstrap response or retained bootstrap data, never evaluated as code. */
    const data = applicationState.bootstrap;
    if (data.snapshot && Object.keys(data.snapshot).length > 0) {
      renderOverview(data.snapshot, data.modules || []);
      renderPages(data.snapshot);
      renderModules(data.modules || []);
      renderDiagnostics(data.snapshot);
      if (data.modules) {
        preloadModules(data.modules, applicationState.sectionId);
      }
    } else {
      await refresh();
    }
  } else {
    await refresh();
  }

  /** Current page-owned shared socket borrowed by module facades and update listeners. */
  const socket = createDevtoolsSocket();
  applicationState.devtoolsSocket = socket;
  applicationState.socket = socket;
  socket.addEventListener('open', () => {
    /** Existing authored socket-status text node. */
    const badge = document.getElementById('ws-badge');
    if (badge) {
      badge.textContent = 'ws: connected';
    }
  });
  socket.addEventListener('message', () => {
    refresh().catch(() => undefined);
  });
  socket.addEventListener(
    'close',
    () => {
      /** Existing authored socket-status text node. */
      const badge = document.getElementById('ws-badge');
      if (badge) {
        badge.textContent = 'ws: reconnecting';
      }
      setTimeout(setupApplication, 1000);
    },
    { once: true }
  );
};

setupThemeToggle();
if (config.page === 'application') {
  setupApplication().catch(() => undefined);
}
