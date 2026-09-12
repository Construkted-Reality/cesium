import { openDB } from "idb";
import { LRUCache } from "lru-cache";

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

function makeResponse(entry, tier) {
  const headers = new Headers(entry.headers);
  headers.set("X-Construkted-Cache", tier);
  return new Response(entry.bytes.slice(0), { status: 200, headers });
}

export class ResponseStore {
  constructor(namespace, config) {
    this.namespace = namespace;
    this.config = config;
    this.memory = new LRUCache({
      maxSize: Math.max(1, config.memoryBytes),
      sizeCalculation: (entry) => Math.max(1, entry.bytes.byteLength),
    });
    this.stats = {
      memoryHits: 0,
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

  remember(key, entry) {
    if (
      entry.bytes.byteLength > 0 &&
      entry.bytes.byteLength <= this.config.memoryBytes
    ) {
      this.memory.set(key, entry);
    }
  }

  async get(key) {
    await this.ready;
    const memory = this.memory.get(key);
    if (memory) {
      this.stats.memoryHits++;
      await this.touch(key);
      return makeResponse(memory, "memory");
    }
    return this.lock(async () => {
      const record = await this.db.get("entries", key);
      const response = record && (await this.cache.match(key));
      if (!response) {
        this.stats.misses++;
        return undefined;
      }
      record.lastAccess = Date.now();
      record.hits++;
      await this.db.put("entries", record);
      this.stats.diskHits++;
      if (record.bytes <= this.config.memoryBytes) {
        const bytes = await response.arrayBuffer();
        const entry = { bytes, headers: [...response.headers] };
        this.remember(key, entry);
        return makeResponse(entry, "disk");
      }
      const headers = new Headers(response.headers);
      headers.set("X-Construkted-Cache", "disk");
      return new Response(response.body, { headers });
    });
  }

  async touch(key) {
    await this.lock(async () => {
      const record = await this.db.get("entries", key);
      if (record) {
        record.lastAccess = Date.now();
        record.hits++;
        await this.db.put("entries", record);
      }
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
    records.sort((a, b) => {
      const protectedDifference =
        this.config.policy === "revisited"
          ? Number(a.hits > 0) - Number(b.hits > 0)
          : 0;
      return (
        protectedDifference ||
        a.lastAccess - b.lastAccess ||
        a.key.localeCompare(b.key)
      );
    });
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
      Math.max(this.config.diskBytes, this.config.memoryBytes),
    );
    const bytes = await boundedBody(response, limit);
    if (!bytes || bytes.byteLength === 0) {
      this.stats.bypasses++;
      return;
    }
    const headers = new Headers(response.headers);
    headers.delete("Content-Encoding");
    headers.set("Content-Length", String(bytes.byteLength));
    const entry = { bytes, headers: [...headers] };
    this.remember(key, entry);
    if (bytes.byteLength > this.config.diskBytes) {
      return;
    }
    await this.lock(async () => {
      await this.evict(bytes.byteLength, key);
      try {
        await this.cache.put(key, new Response(bytes, { headers }));
        await this.db.put("entries", {
          key,
          namespace: this.namespace,
          bytes: bytes.byteLength,
          lastAccess: Date.now(),
          hits: 0,
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
      memoryBytes: this.memory.calculatedSize,
      diskBytes: records.reduce((sum, record) => sum + record.bytes, 0),
      entries: records.length,
      config: this.config,
    };
  }

  async clearMemory() {
    await this.ready;
    await Promise.allSettled([...this.pending]);
    this.memory.clear();
  }

  async clear() {
    await this.ready;
    await Promise.allSettled([...this.pending]);
    this.memory.clear();
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
