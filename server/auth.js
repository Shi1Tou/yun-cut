import {
  base64UrlToBytes,
  bytesToBase64Url,
  encodeCookie,
  parseCookies,
  safeEqualText,
  sha256Hex,
  utf8ToBase64Url,
  base64UrlToUtf8,
} from "./http.js";

export const SESSION_COOKIE = "yunclip_admin";
const DEFAULT_TTL_HOURS = 24;
const SESSION_VERSION = 1;

function cleanHex(value) {
  return String(value || "").trim().toLowerCase().replace(/[^0-9a-f]/g, "");
}

export function getAdminConfig(env = {}) {
  const username = String(env.ADMIN_USERNAME || "admin").trim() || "admin";
  const password = String(env.ADMIN_PASSWORD || "");
  const passwordHash = cleanHex(env.ADMIN_PASSWORD_SHA256);
  const hasHash = passwordHash.length === 64;
  return {
    username,
    password,
    passwordHash: hasHash ? passwordHash : "",
    configured: Boolean(password) || hasHash,
  };
}

export function sessionTtlMs(env = {}) {
  const hours = Number(env.SESSION_TTL_HOURS || DEFAULT_TTL_HOURS);
  const safeHours = Number.isFinite(hours) ? Math.min(24 * 30, Math.max(1, hours)) : DEFAULT_TTL_HOURS;
  return safeHours * 60 * 60 * 1000;
}

export async function verifyAdminCredentials(env, username, password) {
  const config = getAdminConfig(env);
  if (!config.configured) return false;
  const usernameOk = await safeEqualText(String(username || ""), config.username);
  let passwordOk = false;
  if (config.passwordHash) {
    passwordOk = await safeEqualText(await sha256Hex(String(password || "")), config.passwordHash);
  } else {
    passwordOk = await safeEqualText(String(password || ""), config.password);
  }
  return usernameOk && passwordOk;
}

export async function adminFingerprint(env) {
  const config = getAdminConfig(env);
  if (config.passwordHash) return (await sha256Hex(`hash:${config.passwordHash}`)).slice(0, 24);
  return (await sha256Hex(`password:${config.password}`)).slice(0, 24);
}

export async function getSessionSecret(env) {
  const configured = String(env.SESSION_SECRET || "");
  if (configured.length >= 16) return configured;
  const config = getAdminConfig(env);
  if (!config.configured) return "";
  // 未配置 SESSION_SECRET 时使用管理员凭据派生密钥，保证开箱即用；
  // 生产环境仍建议显式设置随机 SESSION_SECRET。
  return `derived:${await sha256Hex(`yunclip-session:${config.username}:${config.passwordHash || config.password}`)}`;
}

async function hmacKey(env) {
  const secret = await getSessionSecret(env);
  if (!secret) return null;
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign(env, payload) {
  const key = await hmacKey(env);
  if (!key) return "";
  const data = new TextEncoder().encode(payload);
  const signature = await crypto.subtle.sign("HMAC", key, data);
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function createSessionToken(env, username) {
  const config = getAdminConfig(env);
  const now = Date.now();
  const payload = {
    v: SESSION_VERSION,
    sub: username,
    fp: await adminFingerprint(env),
    iat: now,
    exp: now + sessionTtlMs(env),
  };
  const encoded = utf8ToBase64Url(JSON.stringify(payload));
  const signature = await sign(env, encoded);
  if (!signature) throw new Error("session secret unavailable");
  return {
    token: `${encoded}.${signature}`,
    expiresAt: payload.exp,
    maxAge: Math.floor((payload.exp - now) / 1000),
    username: config.username,
  };
}

export async function verifySessionToken(env, token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  const expected = await sign(env, encoded);
  if (!expected) return null;
  if (!(await safeEqualText(signature, expected))) return null;
  let payload;
  try {
    payload = JSON.parse(base64UrlToUtf8(encoded));
  } catch {
    return null;
  }
  if (!payload || payload.v !== SESSION_VERSION) return null;
  if (typeof payload.exp !== "number" || payload.exp <= Date.now()) return null;
  const config = getAdminConfig(env);
  if (payload.sub !== config.username) return null;
  if (payload.fp !== (await adminFingerprint(env))) return null;
  return { username: config.username, expiresAt: payload.exp };
}

export function sessionCookie(token, maxAge, secure) {
  return encodeCookie(SESSION_COOKIE, token, {
    maxAge,
    secure,
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
  });
}

export function clearSessionCookie() {
  return encodeCookie(SESSION_COOKIE, "", {
    maxAge: 0,
    expires: new Date(0),
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
  });
}

export async function getAdminFromRequest(request, env) {
  const config = getAdminConfig(env);
  if (!config.configured) return null;
  const cookies = parseCookies(request);
  return verifySessionToken(env, cookies[SESSION_COOKIE]);
}

// 兼容可能被外部引用的工具函数
export function decodeSessionPayload(token) {
  try {
    const encoded = String(token).split(".")[0];
    return JSON.parse(base64UrlToUtf8(encoded));
  } catch {
    return null;
  }
}

export function safeTokenBytes(value) {
  try {
    return base64UrlToBytes(value);
  } catch {
    return new Uint8Array();
  }
}
