export function validateConfig(input, origin) {
  const config = {
    scope: input.scope,
    version: input.version,
    urlPrefix: new URL(input.urlPrefix, origin).href,
    diskBytes: input.diskBytes ?? 256 * 1024 * 1024,
    maximumEntryBytes: input.maximumEntryBytes ?? 16 * 1024 * 1024,
  };
  for (const field of ["scope", "version"]) {
    if (typeof config[field] !== "string" || !config[field].length) {
      throw new Error(`${field} must be a nonempty, non-secret identifier`);
    }
  }
  const prefix = new URL(config.urlPrefix);
  if (
    !/^https?:$/.test(prefix.protocol) ||
    prefix.search ||
    prefix.hash ||
    prefix.username ||
    prefix.password ||
    !prefix.pathname.endsWith("/")
  ) {
    throw new Error(
      "urlPrefix must be an HTTP directory URL without credentials, query or fragment",
    );
  }
  for (const field of ["diskBytes", "maximumEntryBytes"]) {
    if (!Number.isSafeInteger(config[field]) || config[field] < 0) {
      throw new Error(`${field} must be a nonnegative safe integer`);
    }
  }
  if (input.memoryBytes !== undefined || input.policy !== undefined) {
    throw new Error(
      "Response storage is disk-only with LRU eviction; remove memoryBytes and policy",
    );
  }
  return config;
}

export async function digest(value) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function namespaceFor(config) {
  return `construkted-tiles-v1-${await digest(JSON.stringify([config.scope, config.version, config.urlPrefix]))}`;
}

export async function keyFor(request, namespace) {
  // Exact URL and request headers preserve representation and authorization.
  // Only the digest is persisted; bearer tokens are not stored in metadata.
  const identity = JSON.stringify([
    request.url,
    [...request.headers].sort(),
    request.credentials,
    request.mode,
  ]);
  return `${self.location.origin}/__tile_cache__/${namespace}/${await digest(identity)}`;
}
