// Diagnostic worker only. Keep production cache responses unchanged.
import { ResponseStore } from "../../packages/tile-cache/src/store.js";
import "../../packages/tile-cache/src/worker.js";
const get = ResponseStore.prototype.get;
ResponseStore.prototype.get = async function (...args) {
  const start = performance.now();
  const response = await get.apply(this, args);
  const duration = performance.now() - start;
  if (!response) {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.set("X-Cesium-Cache-Lookup-Ms", String(duration));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};
