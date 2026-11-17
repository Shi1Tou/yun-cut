const encoder = new TextEncoder();

export class StorageUnavailableError extends Error {
  constructor(message = "KV 存储未配置") {
    super(message);
    this.name = "StorageUnavailableError";
  }
}

export class MemoryKV {
  constructor(initial = {}) {
    this.map = new Map();
    for (const [key, value] of Object.entries(initial)) this.map.set(key, String(value));
  }

  async get(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  async put(key, value) {
    this.map.set(String(key), typeof value === "string" ? value : String(value));
  }

  async delete(key) {
    this.map.delete(String(key));
  }

  async list(options = {}) {
    const prefix = options.prefix || "";
    const limit = Math.max(1, Math.min(256, Number(options.limit) || 256));
    const keys = Array.from(this.map.keys())
      .filter((key) => key.startsWith(prefix))
      .sort();
    let start = 0;
    if (options.cursor) {
      const index = keys.indexOf(options.cursor);
      start = index >= 0 ? index : keys.length;
    }
    const page = keys.slice(start, start + limit);
    const complete = start + page.length >= keys.length;
    return {
      keys: page.map((key) => ({ key })),
      cursor: complete ? null : keys[start + page.length],
      complete,
    };
  }

  size() {
    return this.map.size;
  }
}

export class KvStore {
  constructor(kv) {
    this.kv = kv;
  }

  get available() {
    return Boolean(this.kv && typeof this.kv.get === "function" && typeof this.kv.put === "function");
  }

  assertAvailable() {
    if (!this.available) throw new StorageUnavailableError();
  }

  async getString(key) {
    this.assertAvailable();
    const value = await this.kv.get(key);
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return value;
    if (value instanceof ArrayBuffer) return new TextDecoder().decode(value);
    return String(value);
  }

  async getJSON(key, fallback = null) {
    const raw = await this.getString(key);
    if (raw === null || raw === "") return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  async put(key, value) {
    this.assertAvailable();
    const text = typeof value === "string" ? value : JSON.stringify(value);
    await this.kv.put(key, text);
  }

  async putJSON(key, value) {
    await this.put(key, JSON.stringify(value));
  }

  async delete(key) {
    this.assertAvailable();
    await this.kv.delete(key);
  }

  async list(prefix, options = {}) {
    this.assertAvailable();
    if (typeof this.kv.list !== "function") return { keys: [], cursor: null, complete: true };
    const limit = Math.max(1, Math.min(256, Number(options.limit) || 256));
    const payload = { prefix, limit };
    if (options.cursor) payload.cursor = options.cursor;
    const result = await this.kv.list(payload);
    const keys = (result?.keys || []).map((item) => {
      if (typeof item === "string") return item;
      return String(item?.key ?? item?.name ?? "");
    }).filter(Boolean);
    const complete = Boolean(result?.complete ?? result?.list_complete ?? keys.length < limit);
    const cursor = result?.cursor ?? result?.nextCursor ?? null;
    return { keys, cursor, complete };
  }

  async listAll(prefix, options = {}) {
    const max = Math.max(1, Number(options.max) || 2000);
    const collected = [];
    let cursor = null;
    for (let page = 0; page < 40; page++) {
      const result = await this.list(prefix, { limit: 256, cursor });
      for (const key of result.keys) {
        if (!collected.includes(key)) collected.push(key);
        if (collected.length >= max) return collected;
      }
      if (result.complete || !result.cursor || result.cursor === cursor) break;
      cursor = result.cursor;
    }
    return collected;
  }
}

export function createStore(kv) {
  return new KvStore(kv);
}

export async function mapLimit(items, limit, mapper) {
  const output = new Array(items.length);
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index++;
      output[current] = await mapper(items[current], current);
    }
  }
  const workers = Array.from({ length: Math.min(Math.max(1, limit), Math.max(1, items.length)) }, () => worker());
  await Promise.all(workers);
  return output;
}

export function randomKeySuffix() {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

export function utf8ByteLength(text) {
  return encoder.encode(text).length;
}
