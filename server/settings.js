import { HttpError } from "./http.js";

export const MAX_CONTENT_CHARS = 300_000;

export const EXPIRY_OPTIONS = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

export const DEFAULT_SETTINGS = Object.freeze({
  siteName: "云夹",
  tagline: "文字留在云端，灵感跟着你走。",
  description: "一个极简、免登录的在线云剪贴板。写下文字，换个设备打开同一个链接，继续编辑。",
  announcement: "",
  footerText: "",
  allowCreate: true,
  maxNoteLength: 200_000,
  defaultExpiry: "never",
  updatedAt: 0,
});

const SETTINGS_KEY = "config_site";

function text(value, maxLength) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, maxLength);
}

export function isExpiryValue(value) {
  return value === "never" || Object.prototype.hasOwnProperty.call(EXPIRY_OPTIONS, value);
}

export function normalizeSettings(input, base = DEFAULT_SETTINGS, { touch = true } = {}) {
  if (!input || typeof input !== "object") {
    throw new HttpError(400, "INVALID_SETTINGS", "设置内容不正确");
  }
  const merged = { ...DEFAULT_SETTINGS, ...base };
  const next = {
    siteName: text(input.siteName ?? merged.siteName, 40) || "云夹",
    tagline: text(input.tagline ?? merged.tagline, 120),
    description: text(input.description ?? merged.description, 240),
    announcement: text(input.announcement ?? merged.announcement, 240),
    footerText: text(input.footerText ?? merged.footerText, 120),
    allowCreate: input.allowCreate === undefined ? Boolean(merged.allowCreate) : input.allowCreate === true,
    maxNoteLength: Number(input.maxNoteLength ?? merged.maxNoteLength),
    defaultExpiry: input.defaultExpiry ?? merged.defaultExpiry,
    updatedAt: touch ? Date.now() : Number(input.updatedAt ?? base.updatedAt) || 0,
  };
  if (!Number.isFinite(next.maxNoteLength)) next.maxNoteLength = 200_000;
  next.maxNoteLength = Math.max(1_000, Math.min(MAX_CONTENT_CHARS, Math.round(next.maxNoteLength)));
  if (!isExpiryValue(next.defaultExpiry)) next.defaultExpiry = "never";
  return next;
}

export async function loadSettings(store, { fallback = true } = {}) {
  if (!store.available) {
    if (fallback) return { ...DEFAULT_SETTINGS };
    throw new HttpError(503, "STORAGE_NOT_CONFIGURED", "尚未绑定 KV 存储");
  }
  const saved = await store.getJSON(SETTINGS_KEY, null);
  return normalizeSettings(saved || {}, DEFAULT_SETTINGS, { touch: false });
}

export async function saveSettings(store, settings) {
  await store.putJSON(SETTINGS_KEY, settings);
  return settings;
}

export function expiryToTimestamp(value, now = Date.now()) {
  if (value === undefined) return undefined;
  if (value === null || value === "" || value === "never") return null;
  if (typeof value === "string" && Object.prototype.hasOwnProperty.call(EXPIRY_OPTIONS, value)) {
    return now + EXPIRY_OPTIONS[value];
  }
  throw new HttpError(400, "INVALID_EXPIRY", "有效期参数不正确");
}

export function timestampToExpiry(value) {
  if (value === null || value === undefined) return "never";
  const remaining = value - Date.now();
  if (remaining <= 0) return "expired";
  let closest = "custom";
  let distance = Infinity;
  for (const [name, ms] of Object.entries(EXPIRY_OPTIONS)) {
    const diff = Math.abs(ms - remaining);
    if (diff < distance) {
      distance = diff;
      closest = name;
    }
  }
  return distance < 5 * 60 * 1000 ? closest : "custom";
}
