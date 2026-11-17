import {
  HttpError,
  bytesToHex,
  hexToBytes,
  randomHex,
  randomId,
} from "./http.js";
import { mapLimit, utf8ByteLength } from "./store.js";
import { MAX_CONTENT_CHARS, expiryToTimestamp } from "./settings.js";

const encoder = new TextEncoder();
const SLUG_RE = /^[\p{L}\p{N}_-]+$/u;
const RESERVED_SLUGS = new Set([
  "api", "admin", "assets", "n", "new", "login", "logout", "faq",
  "health", "site", "notes", "index.html", "404.html", "favicon.ico",
  "favicon.svg", "og.png", "apple-touch-icon.png", "robots.txt", "sitemap.xml",
]);
const MAX_CONTENT_BYTES = 700_000;
const PBKDF2_ITERATIONS = 25_000;

export function normalizeSlug(input) {
  const slug = String(input ?? "").normalize("NFKC").trim();
  if (!slug) throw new HttpError(400, "INVALID_SLUG", "剪贴板名称不能为空");
  if ([...slug].length > 32) throw new HttpError(400, "INVALID_SLUG", "剪贴板名称最多 32 个字符");
  if (!SLUG_RE.test(slug)) {
    throw new HttpError(400, "INVALID_SLUG", "名称只能包含文字、数字、下划线和短横线");
  }
  if (slug.startsWith("_") || slug.startsWith("-")) {
    throw new HttpError(400, "INVALID_SLUG", "名称不能以下划线或短横线开头");
  }
  if (RESERVED_SLUGS.has(slug.toLowerCase())) {
    throw new HttpError(409, "SLUG_RESERVED", "这个名称是系统保留字，请换一个");
  }
  return slug;
}

export function normalizeTitle(input) {
  if (input === undefined || input === null) return "";
  return String(input)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .trim()
    .slice(0, 120);
}

export function normalizeContent(input, maxLength = 200_000) {
  if (input === undefined || input === null) input = "";
  if (typeof input !== "string") throw new HttpError(400, "INVALID_CONTENT", "内容必须是文本");
  let content = input.replace(/\r\n?/g, "\n").replace(/\u0000/g, "");
  const limit = Math.max(1, Math.min(MAX_CONTENT_CHARS, Number(maxLength) || 200_000));
  if ([...content].length > limit) {
    throw new HttpError(413, "CONTENT_TOO_LARGE", `内容超过 ${limit.toLocaleString()} 个字符限制`);
  }
  if (utf8ByteLength(content) > MAX_CONTENT_BYTES) {
    throw new HttpError(413, "CONTENT_TOO_LARGE", "内容体积过大，请拆分后再保存");
  }
  return content;
}

export function normalizePassword(input) {
  if (input === undefined || input === null || input === "") return null;
  if (typeof input !== "string") throw new HttpError(400, "INVALID_PASSWORD", "密码格式不正确");
  if (input.length < 4) throw new HttpError(400, "PASSWORD_TOO_SHORT", "密码至少需要 4 个字符");
  if (input.length > 128) throw new HttpError(400, "PASSWORD_TOO_LONG", "密码最多 128 个字符");
  return input;
}

export async function hashNotePassword(password) {
  const clean = normalizePassword(password);
  if (!clean) return null;
  const salt = hexToBytes(randomHex(16));
  const key = await crypto.subtle.importKey("raw", encoder.encode(clean), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(new Uint8Array(bits))}`;
}

export async function verifyNotePassword(stored, password) {
  if (!stored) return true;
  if (typeof password !== "string" || !password) return false;
  const parts = String(stored).split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  try {
    const salt = hexToBytes(parts[2]);
    const expected = parts[3];
    const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
      key,
      256,
    );
    return bytesToHex(new Uint8Array(bits)) === expected;
  } catch {
    return false;
  }
}

export function slugToHex(slug) {
  return bytesToHex(encoder.encode(slug));
}

export function noteKey(slug) {
  return `note_${slugToHex(slug)}`;
}

export function indexKey(slug) {
  return `idx_${slugToHex(slug)}`;
}

export function viewKey(slug) {
  return `pv_${slugToHex(slug)}`;
}

export function publicNote(note, { content = true } = {}) {
  const output = {
    slug: note.slug,
    title: note.title || "",
    version: note.version,
    views: note.views || 0,
    size: note.size || 0,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    expiresAt: note.expiresAt ?? null,
    protected: Boolean(note.pwd),
  };
  if (content) output.content = note.content || "";
  return output;
}

export function metaFromNote(note) {
  return {
    slug: note.slug,
    title: note.title || "",
    version: note.version,
    views: note.views || 0,
    size: note.size || 0,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
    expiresAt: note.expiresAt ?? null,
    protected: Boolean(note.pwd),
  };
}

async function exists(store, slug) {
  return (await store.getString(indexKey(slug))) !== null;
}

async function uniqueSlug(store) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = randomId(10);
    if (!(await exists(store, candidate))) return candidate;
  }
  throw new HttpError(500, "SLUG_GENERATION_FAILED", "暂时无法生成名称，请重试");
}

export async function getNoteRecord(store, slug) {
  const [note, viewData] = await Promise.all([
    store.getJSON(noteKey(slug), null),
    store.getJSON(viewKey(slug), null),
  ]);
  if (!note || note.slug !== slug) return null;
  if (note.expiresAt && note.expiresAt <= Date.now()) {
    await deleteRecord(store, note, { updateStats: true });
    return null;
  }
  const liveViews = Number(viewData?.count);
  if (Number.isFinite(liveViews) && liveViews >= 0) note.views = liveViews;
  return note;
}

export async function createNote(store, settings, input, { ip = "unknown" } = {}) {
  if (!settings.allowCreate) {
    throw new HttpError(403, "CREATE_DISABLED", "管理员暂时关闭了新建入口");
  }
  const content = normalizeContent(input.content ?? "", settings.maxNoteLength);
  const title = normalizeTitle(input.title);
  const customSlug = input.slug !== undefined && String(input.slug).trim() !== "";
  let slug;
  if (customSlug) {
    slug = normalizeSlug(input.slug);
    if (await exists(store, slug)) throw new HttpError(409, "SLUG_TAKEN", "这个名称已经被使用了");
  } else {
    slug = await uniqueSlug(store);
  }
  const now = Date.now();
  let expiresAt;
  if (input.expiresIn === undefined) {
    expiresAt = expiryToTimestamp(settings.defaultExpiry, now);
  } else {
    expiresAt = expiryToTimestamp(input.expiresIn, now);
  }
  const pwd = input.password ? await hashNotePassword(input.password) : null;
  const note = {
    slug,
    title,
    content,
    version: 1,
    views: 0,
    size: utf8ByteLength(content),
    createdAt: now,
    updatedAt: now,
    expiresAt: expiresAt ?? null,
    pwd,
  };
  await store.putJSON(noteKey(slug), note);
  await store.putJSON(indexKey(slug), metaFromNote(note));
  await bumpStats(store, { notes: 1, chars: note.size }, { created: 1 }, now);
  return note;
}

export async function requireNotePassword(note, password) {
  if (!note.pwd) return true;
  const ok = await verifyNotePassword(note.pwd, password);
  if (!ok) {
    throw new HttpError(401, "PASSWORD_INVALID", "密码不正确", { passwordRequired: true });
  }
  return true;
}

export async function updateNote(store, note, input, maxLength = MAX_CONTENT_CHARS) {
  if (input.version !== undefined && Number(input.version) !== note.version) {
    throw new HttpError(409, "VERSION_CONFLICT", "这个剪贴板已在其他设备更新", {
      currentVersion: note.version,
      currentUpdatedAt: note.updatedAt,
    });
  }
  const now = Date.now();
  let content = note.content || "";
  if (Object.prototype.hasOwnProperty.call(input, "content")) {
    content = normalizeContent(input.content, maxLength);
  }
  let title = note.title || "";
  if (Object.prototype.hasOwnProperty.call(input, "title")) title = normalizeTitle(input.title);
  let pwd = note.pwd || null;
  if (Object.prototype.hasOwnProperty.call(input, "setPassword")) {
    if (input.setPassword === null || input.setPassword === "") pwd = null;
    else pwd = await hashNotePassword(input.setPassword);
  }
  let expiresAt = note.expiresAt ?? null;
  if (Object.prototype.hasOwnProperty.call(input, "expiresIn") && input.expiresIn !== "keep") {
    expiresAt = expiryToTimestamp(input.expiresIn, now) ?? null;
  }
  const next = {
    ...note,
    content,
    title,
    pwd,
    expiresAt,
    size: utf8ByteLength(content),
    version: note.version + 1,
    updatedAt: now,
  };
  await store.putJSON(noteKey(note.slug), next);
  await store.putJSON(indexKey(note.slug), metaFromNote(next));
  const charDelta = next.size - (note.size || 0);
  await bumpStats(store, { saves: 1, chars: charDelta }, { saves: 1 }, now);
  return next;
}

export async function deleteRecord(store, note, { updateStats = true } = {}) {
  await store.delete(noteKey(note.slug));
  await store.delete(indexKey(note.slug));
  await store.delete(viewKey(note.slug));
  if (updateStats) {
    await bumpStats(store, { notes: -1, chars: -(note.size || 0) }, {}, Date.now());
  }
}

export async function deleteNoteBySlug(store, slug) {
  const note = await getNoteRecord(store, slug);
  if (!note) return null;
  await deleteRecord(store, note, { updateStats: true });
  return note;
}

export async function recordView(store, slug) {
  const key = viewKey(slug);
  const current = await store.getJSON(key, {});
  const count = Math.max(0, Number(current?.count) || 0) + 1;
  await store.putJSON(key, { count, updatedAt: Date.now() });
  await bumpStats(store, { views: 1 }, { views: 1 }, Date.now());
  return count;
}

const EMPTY_STATS = { notes: 0, chars: 0, views: 0, saves: 0, updatedAt: 0 };

function statsKey() {
  return "stat_global";
}

function dayKey(ms = Date.now()) {
  return `stat_day_${new Date(ms).toISOString().slice(0, 10).replace(/-/g, "")}`;
}

export async function getGlobalStats(store) {
  return { ...EMPTY_STATS, ...(await store.getJSON(statsKey(), {})) };
}

export async function getDayStats(store, ms) {
  return { created: 0, saves: 0, views: 0, ...(await store.getJSON(dayKey(ms), {})) };
}

export async function bumpStats(store, globalDelta = {}, dayDelta = {}, now = Date.now()) {
  const global = { ...EMPTY_STATS, ...(await store.getJSON(statsKey(), {})) };
  global.notes = Math.max(0, (global.notes || 0) + (globalDelta.notes || 0));
  global.chars = Math.max(0, (global.chars || 0) + (globalDelta.chars || 0));
  global.views = Math.max(0, (global.views || 0) + (globalDelta.views || 0));
  global.saves = Math.max(0, (global.saves || 0) + (globalDelta.saves || 0));
  global.updatedAt = now;
  const day = { created: 0, saves: 0, views: 0, ...(await store.getJSON(dayKey(now), {})) };
  day.created = Math.max(0, (day.created || 0) + (dayDelta.created || 0));
  day.saves = Math.max(0, (day.saves || 0) + (dayDelta.saves || 0));
  day.views = Math.max(0, (day.views || 0) + (dayDelta.views || 0));
  await Promise.all([store.putJSON(statsKey(), global), store.putJSON(dayKey(now), day)]);
  return { global, day };
}

export async function listAllMeta(store, { max = 3000 } = {}) {
  const keys = await store.listAll("idx_", { max });
  const metas = await mapLimit(keys, 20, async (key) => {
    try {
      return await store.getJSON(key, null);
    } catch {
      return null;
    }
  });
  const now = Date.now();
  return metas
    .filter((meta) => meta && typeof meta.slug === "string")
    .map((meta) => ({ ...meta, expired: Boolean(meta.expiresAt && meta.expiresAt <= now) }));
}

export async function cleanupExpired(store) {
  const metas = await listAllMeta(store, { max: 3000 });
  const expired = metas.filter((meta) => meta.expiresAt && meta.expiresAt <= Date.now());
  let removed = 0;
  for (const meta of expired) {
    const note = await store.getJSON(noteKey(meta.slug), null);
    if (note) {
      await deleteRecord(store, note, { updateStats: true });
      removed++;
    } else {
      await store.delete(indexKey(meta.slug));
    }
  }
  return removed;
}

export function buildRecent(metas, limit = 6) {
  return [...metas]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, limit)
    .map((meta) => ({
      slug: meta.slug,
      title: meta.title || "",
      size: meta.size || 0,
      updatedAt: meta.updatedAt,
      createdAt: meta.createdAt,
      protected: Boolean(meta.protected),
      expired: Boolean(meta.expired),
    }));
}
