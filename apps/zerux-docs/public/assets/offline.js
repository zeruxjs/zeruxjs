/** Optional docs-only PWA controls. No worker or cache is installed until the visitor opts in. */
const workerUrl = new URL("../sw.js", import.meta.url);
const scope = new URL("../", import.meta.url);
const enable = document.querySelector("[data-enable-offline]");
const remove = document.querySelector("[data-disable-offline]");
const update = document.querySelector("[data-update-offline]");
const install = document.querySelector("[data-install-app]");
const status = document.querySelector("[data-offline-status]");
let registration;
let installPrompt;
let refreshRequested = false;
const tell = (text) => {
  if (status) status.textContent = text;
};

/** Show controls only for a registration owned by this exact docs mount. @param {ServiceWorkerRegistration} current Registration. @returns {void} Reads browser API state only. */
function connected(current) {
  if (current?.scope !== scope.href) return;
  registration = current;
  enable.hidden = true;
  remove.hidden = false;
  update.hidden = !registration.waiting;
  registration.addEventListener("updatefound", () => {
    const incoming = registration.installing;
    incoming?.addEventListener("statechange", () => {
      if (incoming.state === "installed" && registration.waiting) {
        update.hidden = false;
        tell(
          "A handbook update is ready. Use Update handbook when you are ready to reload.",
        );
      }
    });
  });
  tell(
    navigator.onLine
      ? "Offline reading is enabled for this docs mount. Previously visited eligible pages can be available offline."
      : "You appear offline. Saved content may be older; reconnect for updates.",
  );
}
if ("serviceWorker" in navigator && window.isSecureContext) {
  enable.hidden = false;
  navigator.serviceWorker
    .getRegistration(scope.href)
    .then(connected)
    .catch(() => {});
  enable.addEventListener("click", async () => {
    enable.disabled = true;
    tell("Preparing optional offline reading…");
    try {
      const current = await navigator.serviceWorker.register(workerUrl, {
        scope: scope.pathname,
        updateViaCache: "none",
      });
      // Initial installation failures are reported rather than implying a ready offline cache.
      const worker = current.installing;
      if (worker)
        await new Promise((resolve, reject) => {
          if (worker.state === "activated" || worker.state === "installed") {
            resolve();
            return;
          }
          if (worker.state === "redundant") {
            reject(new Error("Worker installation failed"));
            return;
          }
          worker.addEventListener("statechange", () => {
            if (worker.state === "activated" || worker.state === "installed")
              resolve();
            if (worker.state === "redundant")
              reject(new Error("Worker installation failed"));
          });
        });
      connected(current);
    } catch {
      tell(
        "Offline reading could not be enabled. You can keep reading online.",
      );
    } finally {
      enable.disabled = false;
    }
  });
  remove.addEventListener("click", async () => {
    if (!registration || registration.scope !== scope.href) return;
    remove.disabled = true;
    try {
      await registration.unregister();
      const prefix = `zerux-docs:${scope.pathname}:`;
      for (const name of await caches.keys())
        if (name.startsWith(prefix)) await caches.delete(name);
      registration = undefined;
      remove.hidden = true;
      update.hidden = true;
      enable.hidden = false;
      tell(
        "Offline support removed for this docs mount. Learning progress is unchanged. Reload to release the current page’s worker control.",
      );
    } catch {
      tell(
        "Could not remove all offline data. Use your browser’s site storage settings.",
      );
    } finally {
      remove.disabled = false;
    }
  });
  update.addEventListener("click", () => {
    if (!registration?.waiting) return;
    refreshRequested = true;
    registration.waiting.postMessage({ type: "ACTIVATE_DOCS_UPDATE" });
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (refreshRequested) location.reload();
  });
}
window.addEventListener("offline", () =>
  tell(
    "You appear offline. Only previously cached eligible pages are available.",
  ),
);
window.addEventListener("online", () => {
  if (registration)
    tell(
      "Back online. Pages request fresh content; use Update handbook if an update is available.",
    );
});
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  install.hidden = false;
});
install?.addEventListener("click", async () => {
  if (!installPrompt) return;
  await installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = undefined;
  install.hidden = true;
});
window.addEventListener("appinstalled", () => {
  install.hidden = true;
  tell(
    "Handbook installed. Offline reading remains a separate optional control.",
  );
});
