// Test-only worker: exercise the production network fallback with unavailable IDB.
self.importScripts("/Build/TileCache/worker.js");
self.indexedDB.open = () => {
  throw new DOMException("Injected storage failure", "SecurityError");
};
