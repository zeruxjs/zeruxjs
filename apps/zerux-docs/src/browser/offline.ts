/** Browser-specific installation event, used only after feature detection and a trusted click. */
interface InstallPromptEvent extends Event {
  /** Request the browser-owned installation prompt. */
  prompt(): Promise<void>;
  /** User decision, never used as analytics identity. */
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
export {};
/** Optional docs-only PWA controls. No worker or cache is installed until the visitor opts in. */
/** Fixed same-app worker script; content cannot select an executable service-worker URL. */
const workerUrl = new URL('../sw.js', import.meta.url);
/** Exact docs mount boundary used before reusing or removing any registration. */
const scope = new URL('../', import.meta.url);
/** Visitor-owned opt-in trigger; importing this module never registers a new worker. */
const enable = document.querySelector<HTMLButtonElement>(
  '[data-enable-offline]'
)!;
/** Explicit docs-only removal control, separate from learning-state reset. */
const remove = document.querySelector<HTMLButtonElement>(
  '[data-disable-offline]'
)!;
/** Explicit activation control for an already waiting worker. */
const update = document.querySelector<HTMLButtonElement>(
  '[data-update-offline]'
)!;
/** Optional native install-prompt control; installation and offline caching are separate. */
const install =
  document.querySelector<HTMLButtonElement>('[data-install-app]')!;
/** Live status text reports failures without claiming offline availability. */
const status = document.querySelector<HTMLElement>('[data-offline-status]')!;
let registration: ServiceWorkerRegistration | undefined;
let installPrompt: InstallPromptEvent | undefined;
let refreshRequested = false;
/** Write inert status text only; this helper neither fetches nor installs resources. */
/** Report local PWA state through inert text.
 * @param {string} text - Authored status message, never markup.
 * @returns {void} Updates the optional status region without network work.
 */
const tell = (text: string): void => {
  if (status) {
    status.textContent = text;
  }
};

/** Show controls only for a registration owned by this exact docs mount.
 * @param {ServiceWorkerRegistration} current Registration.
 * @returns {void} Reads browser API state only. */
function connected(current: ServiceWorkerRegistration | undefined): void {
  if (current?.scope !== scope.href) {
    return;
  }
  registration = current;
  enable.hidden = true;
  remove.hidden = false;
  update.hidden = !registration?.waiting;
  current.addEventListener('updatefound', () => {
    /** Installing worker from the exact accepted registration. */
    const incoming = current.installing;
    incoming?.addEventListener('statechange', () => {
      if (incoming.state === 'installed' && current.waiting) {
        update.hidden = false;
        tell(
          'A handbook update is ready. Use Update handbook when you are ready to reload.'
        );
      }
    });
  });
  tell(
    navigator.onLine
      ? 'Offline reading is enabled for this docs mount. Previously visited eligible pages can be available offline.'
      : 'You appear offline. Saved content may be older; reconnect for updates.'
  );
}
if ('serviceWorker' in navigator && window.isSecureContext) {
  enable.hidden = false;
  navigator.serviceWorker
    .getRegistration(scope.href)
    .then(connected)
    .catch(() => {});
  enable.addEventListener('click', async () => {
    enable.disabled = true;
    tell('Preparing optional offline reading…');
    try {
      /** Native registration returned by explicit opt-in, checked against the exact mount. */
      const current = await navigator.serviceWorker.register(workerUrl, {
        scope: scope.pathname,
        updateViaCache: 'none',
      });
      // Initial installation failures are reported rather than implying a ready offline cache.
      /** Actual installation state observed before announcing offline support. */
      const worker = current.installing;
      if (worker) {
        await new Promise<void>((resolve, reject) => {
          if (worker.state === 'activated' || worker.state === 'installed') {
            resolve();
            return;
          }
          if (worker.state === 'redundant') {
            reject(new Error('Worker installation failed'));
            return;
          }
          worker.addEventListener('statechange', () => {
            if (worker.state === 'activated' || worker.state === 'installed') {
              resolve();
            }
            if (worker.state === 'redundant') {
              reject(new Error('Worker installation failed'));
            }
          });
        });
      }
      connected(current);
    } catch {
      tell(
        'Offline reading could not be enabled. You can keep reading online.'
      );
    } finally {
      enable.disabled = false;
    }
  });
  remove.addEventListener('click', async () => {
    if (!registration || registration.scope !== scope.href) {
      return;
    }
    remove.disabled = true;
    try {
      await registration.unregister();
      /** Only this docs mount’s owned caches are eligible for explicit removal. */
      const prefix = `zerux-docs:${scope.pathname}:`;
      for (const name of await caches.keys()) {
        if (name.startsWith(prefix)) {
          await caches.delete(name);
        }
      }
      registration = undefined;
      remove.hidden = true;
      update.hidden = true;
      enable.hidden = false;
      tell(
        'Offline support removed for this docs mount. Learning progress is unchanged. Reload to release the current page’s worker control.'
      );
    } catch {
      tell(
        'Could not remove all offline data. Use your browser’s site storage settings.'
      );
    } finally {
      remove.disabled = false;
    }
  });
  update.addEventListener('click', () => {
    if (!registration?.waiting) {
      return;
    }
    refreshRequested = true;
    registration?.waiting.postMessage({ type: 'ACTIVATE_DOCS_UPDATE' });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshRequested) {
      location.reload();
    }
  });
}
window.addEventListener('offline', () =>
  tell(
    'You appear offline. Only previously cached eligible pages are available.'
  )
);
window.addEventListener('online', () => {
  if (registration) {
    tell(
      'Back online. Pages request fresh content; use Update handbook if an update is available.'
    );
  }
});
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  if (!('prompt' in event) || typeof event.prompt !== 'function') {
    return;
  }
  installPrompt = event as InstallPromptEvent;
  install.hidden = false;
});
install?.addEventListener('click', async () => {
  if (!installPrompt) {
    return;
  }
  await installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = undefined;
  install.hidden = true;
});
window.addEventListener('appinstalled', () => {
  install.hidden = true;
  tell(
    'Handbook installed. Offline reading remains a separate optional control.'
  );
});
