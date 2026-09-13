import { openDB } from "idb";

const database = () =>
  openDB("construkted-tile-cache-v1", 1, {
    upgrade(db) {
      db.createObjectStore("entries", { keyPath: "key" }).createIndex(
        "namespace",
        "namespace",
      );
      db.createObjectStore("clients");
    },
  });

export const openCacheDatabase = database;

async function boundedBody(response, limit) {
  if (!response.body || limit === 0) {
    return undefined;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        return undefined;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.buffer;
}

export class ResponseStore {
  constructor(namespace, config) {
    this.namespace = namespace;
    this.config = config;
    this.stats = {
      diskHits: 0,
      misses: 0,
      network: 0,
      writes: 0,
      evictions: 0,
      errors: 0,
      bypasses: 0,
    };
    this.tail = Promise.resolve();
    this.pending = new Set();
    this.ready = this.initialize();
  }

  async initialize() {
    this.db = await database();
    this.cache = await caches.open(this.namespace);
    await this.lock(async () => {
      const records = await this.db.getAllFromIndex(
        "entries",
        "namespace",
        this.namespace,
      );
      const keys = new Set(
        (await this.cache.keys()).map((request) => request.url),
      );
      for (const record of records) {
        if (!keys.has(record.key)) {
          await this.db.delete("entries", record.key);
        }
        keys.delete(record.key);
      }
      // A response without committed metadata is an interrupted write.
      for (const key of keys) {
        await this.cache.delete(key);
      }
      await this.evict(0);
    });
  }

  lock(operation) {
    const run = () =>
      navigator.locks
        ? navigator.locks.request(this.namespace, operation)
        : operation();
    const result = this.tail.then(run);
    this.tail = result.catch(() => {});
    return result;
  }

  async get(key) {
    await this.ready;
    return this.lock(async () => {
      const record = await this.db.get("entries", key);
      const response = record && (await this.cache.match(key));
      if (!response) {
        this.stats.misses++;
        return undefined;
      }
      record.lastAccess = Date.now();
      await this.db.put("entries", record);
      this.stats.diskHits++;
      const headers = new Headers(response.headers);
      headers.set("X-Construkted-Cache", "disk");
      return new Response(response.body, { headers });
    });
  }

  async evict(incoming, replacing) {
    const records = await this.db.getAllFromIndex(
      "entries",
      "namespace",
      this.namespace,
    );
    let total = records.reduce(
      (sum, record) => sum + (record.key === replacing ? 0 : record.bytes),
      0,
    );
    records.sort(
      (a, b) => a.lastAccess - b.lastAccess || a.key.localeCompare(b.key),
    );
    for (const record of records) {
      if (total + incoming <= this.config.diskBytes) {
        break;
      }
      if (record.key === replacing) {
        continue;
      }
      await this.cache.delete(record.key);
      await this.db.delete("entries", record.key);
      total -= record.bytes;
      this.stats.evictions++;
    }
  }

  async put(key, response) {
    await this.ready;
    if (
      response.status !== 200 ||
      /(?:no-store|no-cache)/i.test(
        response.headers.get("Cache-Control") || "",
      ) ||
      response.headers.get("Vary") === "*"
    ) {
      this.stats.bypasses++;
      return;
    }
    const limit = Math.min(
      this.config.maximumEntryBytes,
      this.config.diskBytes,
    );
    const bytes = await boundedBody(response, limit);
    if (!bytes || bytes.byteLength === 0) {
      this.stats.bypasses++;
      return;
    }
    const headers = new Headers(response.headers);
    headers.delete("Content-Encoding");
    headers.set("Content-Length", String(bytes.byteLength));
    await this.lock(async () => {
      await this.evict(bytes.byteLength, key);
      try {
        await this.cache.put(key, new Response(bytes, { headers }));
        await this.db.put("entries", {
          key,
          namespace: this.namespace,
          bytes: bytes.byteLength,
          lastAccess: Date.now(),
        });
        this.stats.writes++;
      } catch (error) {
        await this.cache.delete(key);
        await this.db.delete("entries", key);
        throw error;
      }
    });
  }

  write(key, response) {
    const operation = this.put(key, response);
    this.pending.add(operation);
    operation.finally(() => this.pending.delete(operation)).catch(() => {});
    return operation;
  }

  async snapshot() {
    await this.ready;
    await Promise.allSettled([...this.pending]);
    await this.tail;
    const records = await this.db.getAllFromIndex(
      "entries",
      "namespace",
      this.namespace,
    );
    return {
      ...this.stats,
      diskBytes: records.reduce((sum, record) => sum + record.bytes, 0),
      entries: records.length,
      config: this.config,
    };
  }

  async clear() {
    await this.ready;
    await Promise.allSettled([...this.pending]);
    await this.lock(async () => {
      const records = await this.db.getAllFromIndex(
        "entries",
        "namespace",
        this.namespace,
      );
      for (const record of records) {
        await this.cache.delete(record.key);
        await this.db.delete("entries", record.key);
      }
    });
  }
}
