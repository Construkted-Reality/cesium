import { ResponseStore } from "../../packages/tile-cache/src/store.js";
import {
  validateConfig,
  namespaceFor,
  keyFor,
} from "../../packages/tile-cache/src/config.js";

window.cacheContracts = async () => {
  const results = [];
  const check = (condition, message) => {
    if (!condition) {
      throw new Error(message);
    }
  };
  const config = {
    scope: "contract",
    version: "v1",
    urlPrefix: `${location.origin}/tile-data/v1/`,
    diskBytes: 16,
    maximumEntryBytes: 16,
  };
  const make = async (label, options = {}) => {
    const store = new ResponseStore(`construkted-test-${label}`, {
      ...config,
      ...options,
    });
    await store.clear();
    return store;
  };
  const key = (name) => `${location.origin}/__contracts__/${name}`;
  const response = (text = "12345678", headers) =>
    new Response(text, { headers });

  const lru = await make("lru");
  await lru.write(key("A"), response());
  await lru.write(key("B"), response());
  await lru.get(key("A"));
  await lru.write(key("C"), response());
  check(!(await lru.get(key("B"))), "LRU did not evict B after touching A");
  await lru.write(key("D"), response());
  check(!(await lru.get(key("A"))), "LRU retained stale A");
  check((await lru.snapshot()).diskBytes === 16, "Disk budget mismatch");
  results.push({
    test: "retention-lru",
    pass: true,
    stats: await lru.snapshot(),
  });
  await lru.clear();

  const disk = await make("disk");
  await disk.write(key("A"), response());
  const body = await (await disk.get(key("A"))).arrayBuffer();
  structuredClone(body, { transfer: [body] });
  check(body.byteLength === 0, "Transfer did not detach the returned buffer");
  check(
    (await (await disk.get(key("A"))).text()) === "12345678",
    "Cached bytes detached",
  );
  await Promise.all(
    Array.from({ length: 20 }).map((value, index) =>
      disk.write(key(`parallel-${value}-${index}`), response()),
    ),
  );
  const snapshot = await disk.snapshot();
  check(
    snapshot.diskBytes <= 16,
    "Concurrent writes exceeded retained budgets",
  );
  results.push({
    test: "ownership-and-concurrent-budgets",
    pass: true,
    stats: snapshot,
  });
  await disk.clear();

  const admission = await make("admission");
  await admission.write(key("large"), response("x".repeat(17)));
  await admission.write(
    key("private"),
    response("12345678", { "Cache-Control": "no-store" }),
  );
  await admission.write(
    key("revalidate"),
    response("12345678", { "Cache-Control": "no-cache" }),
  );
  await admission.write(key("vary"), response("12345678", { Vary: "*" }));
  await admission.write(
    key("partial"),
    new Response("12345678", { status: 206 }),
  );
  check(
    (await admission.snapshot()).entries === 0,
    "Uncacheable response persisted",
  );
  results.push({
    test: "admission",
    pass: true,
    stats: await admission.snapshot(),
  });

  // Simulate both sides of an interrupted response/metadata commit.
  await admission.cache.put(key("orphan"), response());
  await admission.db.put("entries", {
    key: key("missing"),
    namespace: admission.namespace,
    bytes: 8,
    lastAccess: 0,
    hits: 0,
  });
  const reopened = new ResponseStore(admission.namespace, config);
  await reopened.ready;
  check(
    !(await reopened.cache.match(key("orphan"))),
    "Orphan response survived recovery",
  );
  check(
    (await reopened.snapshot()).entries === 0,
    "Dangling metadata survived recovery",
  );
  results.push({ test: "interrupted-write-recovery", pass: true });

  const quota = await make("quota");
  quota.cache.put = async () => {
    throw new DOMException("Injected quota exhaustion", "QuotaExceededError");
  };
  let rejected = false;
  try {
    await quota.write(key("quota"), response());
  } catch {
    rejected = true;
  }
  check(
    rejected && (await quota.snapshot()).entries === 0,
    "Failed write was published",
  );
  results.push({ test: "quota-write-failure", pass: true });

  const namespace = await namespaceFor(config);
  check(
    namespace !==
      (await namespaceFor({ ...config, scope: "different-account" })),
    "Accounts share namespace",
  );
  check(
    namespace !== (await namespaceFor({ ...config, version: "v2" })),
    "Versions share namespace",
  );
  const a = await keyFor(
    new Request(`${location.origin}/same`, {
      headers: { Authorization: "Bearer A" },
    }),
    namespace,
  );
  const b = await keyFor(
    new Request(`${location.origin}/same`, {
      headers: { Authorization: "Bearer B" },
    }),
    namespace,
  );
  check(a !== b && !a.includes("Bearer"), "Authorization key collision");
  for (const input of [
    { diskBytes: -1 },
    { memoryBytes: 0 },
    { urlPrefix: "/not-a-directory" },
    { policy: "lru" },
    { policy: "revisited" },
  ]) {
    let invalid = false;
    try {
      validateConfig({ ...config, ...input }, location.origin);
    } catch {
      invalid = true;
    }
    check(invalid, `Invalid config accepted: ${JSON.stringify(input)}`);
  }
  results.push({ test: "identity-and-configuration", pass: true });
  return results;
};
