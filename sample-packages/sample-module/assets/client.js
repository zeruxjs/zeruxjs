/**
 * Serialize a module response for display in a code block.
 *
 * @param {unknown} value - Value returned by the module API or socket.
 * @returns {string} Pretty-printed JSON representation.
 */
const format = (value) => JSON.stringify(value, null, 2);

/**
 * Mount the sample API and WebSocket controls.
 *
 * @param {{root: HTMLElement, api: Function, socket: object, snapshot?: object}} options - Module mount context.
 * @param {HTMLElement} options.root - Module-owned DOM root.
 * @param {Function} options.api - API request function.
 * @param {object} options.socket - Socket owner with request and lifecycle methods.
 * @param {object} options.snapshot - Current module snapshot.
 * @returns {Promise<{refresh: (nextState?: object) => void, destroy: () => void}>} Module lifecycle handle.
 */
export const mount = async ({ root, api, socket, snapshot }) => {
  /** Sample package value or fixture named apiTarget. */
  const apiTarget = root.querySelector('[data-sample-api]');
  /** Sample package value or fixture named socketTarget. */
  const socketTarget = root.querySelector('[data-sample-socket]');
  /** Sample package value or fixture named socketState. */
  const socketState = root.querySelector('[data-sample-socket-state]');
  /** Sample package value or fixture named refreshButton. */
  const refreshButton = root.querySelector('[data-sample-refresh]');
  /** Sample package value or fixture named pingButton. */
  const pingButton = root.querySelector('[data-sample-ping]');

  /**
   * Refresh the displayed server snapshot.
   *
   * @returns {Promise<void>} Resolves after the API response is rendered.
   */
  const refresh = async () => {
    /** Sample package value or fixture named data. */
    const data = await api('inspect', {
      body: {
        requestedAt: new Date().toISOString(),
      },
    });
    if (apiTarget) {
      apiTarget.textContent = format(data);
    }
  };

  socket.onMessage((message) => {
    if (socketTarget) {
      socketTarget.textContent = format(message.payload ?? message);
    }
    if (socketState && message.type === 'server-channel') {
      socketState.textContent = 'Socket active';
    }
  });

  socket.raw.addEventListener('open', () => {
    if (socketState) {
      socketState.textContent = 'Socket connected';
    }
  });

  socket.raw.addEventListener('close', () => {
    if (socketState) {
      socketState.textContent = 'Socket closed';
    }
  });

  refreshButton?.addEventListener('click', () => {
    refresh().catch((error) => {
      if (apiTarget) {
        apiTarget.textContent = format({
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
  });

  pingButton?.addEventListener('click', () => {
    socket.requestServer('ping', {
      issuedAt: new Date().toISOString(),
      routeCount: Array.isArray(snapshot?.routes) ? snapshot.routes.length : 0,
    });
  });

  await refresh();
  return {
    refresh(nextState) {
      if (apiTarget && !apiTarget.textContent) {
        apiTarget.textContent = format(nextState?.snapshot ?? {});
      }
    },
    destroy() {
      socket.close();
    },
  };
};

export default { mount };
