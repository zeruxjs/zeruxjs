const format = (value) => JSON.stringify(value, null, 2);

export const mount = async ({ root, api, socket, snapshot }) => {
  const apiTarget = root.querySelector("[data-sample-api]");
  const socketTarget = root.querySelector("[data-sample-socket]");
  const socketState = root.querySelector("[data-sample-socket-state]");
  const refreshButton = root.querySelector("[data-sample-refresh]");
  const pingButton = root.querySelector("[data-sample-ping]");

  const refresh = async () => {
    const data = await api("inspect", {
      body: {
        requestedAt: new Date().toISOString()
      }
    });
    if (apiTarget) {
      apiTarget.textContent = format(data);
    }
  };

  socket.onMessage((message) => {
    if (socketTarget) {
      socketTarget.textContent = format(message.payload ?? message);
    }
    if (socketState && message.type === "server-channel") {
      socketState.textContent = "Socket active";
    }
  });

  socket.raw.addEventListener("open", () => {
    if (socketState) {
      socketState.textContent = "Socket connected";
    }
  });

  socket.raw.addEventListener("close", () => {
    if (socketState) {
      socketState.textContent = "Socket closed";
    }
  });

  refreshButton?.addEventListener("click", () => {
    refresh().catch((error) => {
      if (apiTarget) {
        apiTarget.textContent = format({ error: error instanceof Error ? error.message : String(error) });
      }
    });
  });

  pingButton?.addEventListener("click", () => {
    socket.requestServer("ping", {
      issuedAt: new Date().toISOString(),
      routeCount: Array.isArray(snapshot?.routes) ? snapshot.routes.length : 0
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
    }
  };
};

export default { mount };
