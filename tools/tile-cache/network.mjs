// Observe page and Service Worker transports separately. A page response supplied
// by a worker is not another upstream transfer.
export async function observeNetwork(context, page, { prefix, httpCache }) {
  const records = [];
  const pending = new Map();
  const byId = new Map();
  let nextId = 0;
  const browserSession = await context.browser().newBrowserCDPSession();
  function receive(source, method, params) {
    const key = `${source}:${params.requestId}`;
    if (method === "Network.requestWillBeSent" && params.request.url.startsWith(prefix)) {
      const record = { source, url: params.request.url, method: params.request.method,
        startedAt: Date.now(), timestamp: params.timestamp, encodedBytes: 0 };
      records.push(record);
      byId.set(key, record);
    }
    const record = byId.get(key);
    if (!record) {return;}
    if (method === "Network.requestServedFromCache") {record.browserCache = true;}
    if (method === "Network.responseReceived") {
      const response = params.response;
      Object.assign(record, { status: response.status,
        browserCache: record.browserCache || response.fromDiskCache || response.fromPrefetchCache || false,
        fromServiceWorker: response.fromServiceWorker || false,
        headers: response.headers, protocol: response.protocol, timing: response.timing });
    }
    if (method === "Network.loadingFinished") {
      record.encodedBytes = params.encodedDataLength;
      record.finishedAt = Date.now();
    }
    if (method === "Network.loadingFailed") {
      record.error = params.errorText;
      record.cancelled = params.canceled || false;
      record.finishedAt = Date.now();
    }
  }
  function sendWorker(sessionId, method, params = {}) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      browserSession.send("Target.sendMessageToTarget", {
        sessionId, message: JSON.stringify({ id, method, params }),
      }).catch(reject);
    });
  }
  browserSession.on("Target.receivedMessageFromTarget", ({ sessionId, message }) => {
    const packet = JSON.parse(message);
    if (packet.id) {
      const callback = pending.get(packet.id);
      pending.delete(packet.id);
      if (packet.error) {callback?.reject(new Error(packet.error.message));}
      else {callback?.resolve(packet.result);}
    } else {receive(`worker:${sessionId}`, packet.method, packet.params);}
  });
  const errors = [];
  browserSession.on("Target.attachedToTarget", ({ sessionId }) => {
    (async () => {
      await sendWorker(sessionId, "Network.enable");
      await sendWorker(sessionId, "Network.setCacheDisabled", { cacheDisabled: !httpCache });
      await sendWorker(sessionId, "Runtime.runIfWaitingForDebugger");
    })().catch(error => errors.push(String(error)));
  });
  await browserSession.send("Target.setAutoAttach", {
    autoAttach: true, waitForDebuggerOnStart: true, flatten: false,
    filter: [{ type: "service_worker", exclude: false }, { exclude: true }],
  });
  const pageSession = await context.newCDPSession(page);
  for (const method of ["requestWillBeSent", "requestServedFromCache", "responseReceived", "loadingFinished", "loadingFailed"]) {
    pageSession.on(`Network.${method}`, params => receive("page", `Network.${method}`, params));
  }
  await pageSession.send("Network.enable");
  await pageSession.send("Network.setCacheDisabled", { cacheDisabled: !httpCache });
  return { records, errors };
}

export function summarizeNetwork(records) {
  const upstream = records.filter(r => !r.fromServiceWorker && !r.browserCache);
  return {
    requests: records.length,
    upstreamRequests: upstream.length,
    upstreamCompleted: upstream.filter(r => r.status && !r.error).length,
    upstreamEncodedBytes: upstream.reduce((sum, r) => sum + r.encodedBytes, 0),
    browserCacheResponses: records.filter(r => r.browserCache).length,
    serviceWorkerResponses: records.filter(r => r.fromServiceWorker).length,
    cancelled: records.filter(r => r.cancelled).length,
    failures: records.filter(r => r.error && !r.cancelled).length,
  };
}
