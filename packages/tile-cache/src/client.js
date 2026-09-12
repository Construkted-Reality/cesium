function message(worker, action, config) {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error("Tile cache worker did not respond"));
    }, 30000);
    channel.port1.onmessage = ({ data }) => {
      clearTimeout(timer);
      channel.port1.close();
      if (data.error) {
        reject(new Error(data.error));
      } else {
        resolve(data.result);
      }
    };
    worker.postMessage({ action, config }, [channel.port2]);
  });
}

/** Enable caching only for a versioned immutable dataset directory. */
export async function registerTileCache({ workerUrl, ...config }) {
  if (!navigator.serviceWorker || !isSecureContext) {
    throw new Error(
      "Tile caching requires Service Workers in a secure context",
    );
  }
  const expected = new URL(workerUrl, location.href).href;
  const existing = await navigator.serviceWorker.getRegistration("/");
  const installed =
    existing?.active || existing?.waiting || existing?.installing;
  if (installed && installed.scriptURL !== expected) {
    throw new Error(
      "An application Service Worker already owns this scope; integrate the tile strategy into that worker instead",
    );
  }
  const registration = await navigator.serviceWorker.register(workerUrl, {
    scope: "/",
  });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve, reject) => {
      const ready = () => {
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener("controllerchange", ready);
        resolve();
      };
      const timer = setTimeout(() => {
        navigator.serviceWorker.removeEventListener("controllerchange", ready);
        reject(new Error("Tile cache worker did not take control"));
      }, 30000);
      navigator.serviceWorker.addEventListener("controllerchange", ready);
    });
  }
  const call = (action) =>
    message(navigator.serviceWorker.controller, action, config);
  await call("configure");
  return {
    registration,
    stats: () => call("stats"),
    clear: () => call("clear"),
    clearMemory: () => call("clearMemory"),
  };
}
