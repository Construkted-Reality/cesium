import { Strategy } from "workbox-strategies";
import { validateConfig, namespaceFor, keyFor } from "./config.js";
import { ResponseStore, openCacheDatabase } from "./store.js";

const clients = new Map();
const stores = new Map();

async function settings(clientId) {
  if (!clients.has(clientId)) {
    const db = await openCacheDatabase();
    const config = await db.get("clients", clientId);
    db.close();
    if (config) {
      clients.set(clientId, config);
    }
  }
  return clients.get(clientId);
}

async function storeFor(config) {
  const namespace = await namespaceFor(config);
  if (!stores.has(namespace)) {
    stores.set(namespace, new ResponseStore(namespace, config));
  }
  const store = stores.get(namespace);
  if (JSON.stringify(store.config) !== JSON.stringify(config)) {
    throw new Error(
      "Conflicting budgets for the same cache namespace; use one configuration across tabs",
    );
  }
  return store;
}

class TieredStrategy extends Strategy {
  async _handle(request, handler) {
    const config = await settings(handler.event.clientId);
    if (
      !config ||
      request.method !== "GET" ||
      request.headers.has("Range") ||
      !request.url.startsWith(config.urlPrefix)
    ) {
      return handler.fetch(request);
    }
    let store;
    let key;
    try {
      store = await storeFor(config);
      key = await keyFor(request, store.namespace);
      const cached = await store.get(key);
      if (cached) {
        return cached;
      }
    } catch {
      if (store) {
        store.stats.errors++;
      }
    }
    const response = await handler.fetch(request);
    if (store && key) {
      store.stats.network++;
      handler.waitUntil(
        store.write(key, response.clone()).catch(() => {
          store.stats.errors++;
        }),
      );
    }
    return response;
  }
}

const strategy = new TieredStrategy();
self.addEventListener("fetch", (event) => {
  if (event.request.method === "GET" && event.clientId) {
    event.respondWith(strategy.handle({ event, request: event.request }));
  }
});
self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("message", (event) => {
  const port = event.ports[0];
  if (!port || !event.source?.id) {
    return;
  }
  event.waitUntil(
    (async () => {
      try {
        const { action } = event.data;
        let config = await settings(event.source.id);
        if (action === "configure") {
          config = validateConfig(event.data.config, self.location.origin);
          await storeFor(config);
          clients.set(event.source.id, config);
          const db = await openCacheDatabase();
          await db.put("clients", config, event.source.id);
          db.close();
        }
        if (!config) {
          throw new Error("Configure this client first");
        }
        const store = await storeFor(config);
        if (action === "clear") {
          await store.clear();
        }
        if (action === "clearMemory") {
          store.memory.clear();
        }
        port.postMessage({ result: await store.snapshot() });
      } catch (error) {
        port.postMessage({ error: String(error) });
      }
    })(),
  );
});
