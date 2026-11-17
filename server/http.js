const encoder = new TextEncoder();

export const MAX_BODY_BYTES = 850_000;

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function json(data, status = 200, headers = {}) {
  const h = new Headers(headers);
  if (!h.has("content-type")) h.set("content-type", "application/json; charset=utf-8");
  h.set("cache-control", "no-store");
  h.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(data), { status, headers: h });
}

export function fail(status, code, message, extra = {}) {
  return json({ error: { code, message, ...extra } }, status);
}

export async function readJson(request) {
  const declared = Number(request.headers.get("content-length") || "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new HttpError(413, "BODY_TOO_LARGE", "请求内容过大");
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new HttpError(413, "BODY_TOO_LARGE", "请求内容过大");
  }
  if (!raw.trim()) return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, "INVALID_JSON", "请求内容不是合法的 JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new HttpError(400, "INVALID_JSON", "请求内容格式不正确");
  }
  return parsed;
}

export function getClientIp(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    request.headers.get("x-real-ip") ||
    request.headers.get("eo-connecting-ip") ||
    request.headers.get("cf-connecting-ip") ||
    "unknown"
  );
}

export function isSameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) {
    const site = request.headers.get("sec-fetch-site");
    return !site || site === "same-origin" || site === "none";
  }
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const forwardedHost = (request.headers.get("x-forwarded-host") || "").split(",")[0]?.trim();
    const host = forwardedHost || request.headers.get("host") || requestUrl.host;
    const protocolOk = originUrl.protocol === requestUrl.protocol ||
      (requestUrl.protocol === "http:" && originUrl.protocol === "https:");
    return protocolOk && originUrl.host === host;
  } catch {
    return false;
  }
}

export function parseCookies(request) {
  const header = request.headers.get("cookie") || "";
  const cookies = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      cookies[name] = decodeURIComponent(value);
    } catch {
      cookies[name] = value;
    }
  }
  return cookies;
}

const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function bytesToBase64Url(bytes) {
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    output += B64_ALPHABET[a >> 2];
    output += B64_ALPHABET[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) output += B64_ALPHABET[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) output += B64_ALPHABET[c & 63];
  }
  return output;
}

export function base64UrlToBytes(input) {
  const clean = String(input).replace(/=+$/, "");
  if (clean.length % 4 === 1) throw new Error("invalid base64url");
  const out = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const value = B64_ALPHABET.indexOf(char);
    if (value === -1) throw new Error("invalid base64url");
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out.push((buffer >> bits) & 255);
    }
  }
  return new Uint8Array(out);
}

export function utf8ToBase64Url(text) {
  return bytesToBase64Url(encoder.encode(String(text)));
}

export function base64UrlToUtf8(text) {
  return new TextDecoder().decode(base64UrlToBytes(text));
}

export function bytesToHex(bytes) {
  let output = "";
  for (let i = 0; i < bytes.length; i++) output += bytes[i].toString(16).padStart(2, "0");
  return output;
}

export function hexToBytes(hex) {
  const clean = String(hex);
  if (clean.length % 2 !== 0) throw new Error("invalid hex");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const value = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(value)) throw new Error("invalid hex");
    out[i] = value;
  }
  return out;
}

export function randomHex(byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

export function randomId(length = 10) {
  const alphabet = "23456789abcdefghjkmnpqrstuvwxyz";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let output = "";
  for (let i = 0; i < length; i++) output += alphabet[bytes[i] % alphabet.length];
  return output;
}

export async function sha256Bytes(value) {
  const data = typeof value === "string" ? encoder.encode(value) : value;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

export async function sha256Hex(value) {
  return bytesToHex(await sha256Bytes(value));
}

export async function safeEqualText(a, b) {
  const [left, right] = await Promise.all([sha256Bytes(String(a)), sha256Bytes(String(b))]);
  let diff = left.length ^ right.length;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

export function encodeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  parts.push(`Path=${options.path || "/"}`);
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite || "Lax"}`);
  return parts.join("; ");
}

export function csvCell(value) {
  let text = value === null || value === undefined ? "" : String(value);
  // 防止 Excel 将标题等内容当作公式执行
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function isoDate(ms) {
  return new Date(ms).toISOString();
}
