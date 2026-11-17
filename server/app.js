import {
  HttpError,
  bytesToHex,
  csvCell,
  fail,
  getClientIp,
  isSameOrigin,
  json,
  randomHex,
  readJson,
} from "./http.js";
import {
  StorageUnavailableError,
  createStore,
  mapLimit,
} from "./store.js";
import {
  loadSettings,
  normalizeSettings,
  saveSettings,
} from "./settings.js";
import {
  clearSessionCookie,
  createSessionToken,
  getAdminConfig,
  getAdminFromRequest,
  sessionCookie,
  verifyAdminCredentials,
} from "./auth.js";
import {
  buildRecent,
  cleanupExpired,
  createNote,
  deleteRecord,
  getDayStats,
  getGlobalStats,
  getNoteRecord,
  listAllMeta,
  normalizeSlug,
  publicNote,
  recordView,
  requireNotePassword,
  updateNote,
  verifyNotePassword,
} from "./notes.js";

const VERSION = "1.0.0";
const encoder = new TextEncoder();
const RATE_LIMITS = {
  create: { max: 30, windowMs: 60 * 60 * 1000 },
  login: { max: 8, windowMs: 10 * 60 * 1000 },
  password: { max: 20, windowMs: 10 * 60 * 1000 },
};

function resolveKv(env) {
  const bindingName = String(env?.KV_BINDING_NAME || "CLIPBOARD_KV");
  const candidates = [
    env?.[bindingName],
    globalThis[bindingName],
    env?.CLIPBOARD_KV,
    globalThis.CLIPBOARD_KV,
    env?.KV,
    globalThis.KV,
  ];
  for (const candidate of candidates) {
    if (candidate && typeof candidate.get === "function" && typeof candidate.put === "function") {
      return candidate;
    }
  }
  return null;
}

function parseSegments(pathname) {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        throw new HttpError(400, "INVALID_PATH", "请求路径不正确");
      }
    });
}

function intParam(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function dayStamp(ms) {
  return new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
}

async function rateLimit(store, scope, identifier, config) {
  if (!store.available) return { ok: true };
  const key = `rate_${scope}_${bytesToHex(encoder.encode(String(identifier))).slice(0, 160)}`;
  const now = Date.now();
  const record = await store.getJSON(key, null);
  if (!record || !record.resetAt || record.resetAt <= now) {
    await store.putJSON(key, { count: 1, resetAt: now + config.windowMs });
    return { ok: true, remaining: config.max - 1, resetAt: now + config.windowMs };
  }
  if (Number(record.count) >= config.max) {
    return { ok: false, retryAfter: Math.max(1, Math.ceil((record.resetAt - now) / 1000)), resetAt: record.resetAt };
  }
  await store.putJSON(key, { count: Number(record.count) + 1, resetAt: record.resetAt });
  return { ok: true, remaining: Math.max(0, config.max - Number(record.count) - 1), resetAt: record.resetAt };
}

function tooMany(retryAfter) {
  return fail(429, "RATE_LIMITED", `请求太频繁了，请 ${retryAfter} 秒后再试`, { retryAfter });
}

async function writeAudit(store, action, { target = "", ip = "unknown", detail = "" } = {}) {
  if (!store.available) return;
  const now = Date.now();
  const key = `audit_${String(now).padStart(13, "0")}_${randomHex(4)}`;
  try {
    await store.putJSON(key, {
      at: now,
      action: String(action).slice(0, 60),
      target: String(target).slice(0, 180),
      ip: String(ip).slice(0, 80),
      detail: String(detail).slice(0, 240),
    });
  } catch {
    // 审计日志不能阻碍主流程
  }
}

async function listAudit(store, limit = 80) {
  const keys = await store.listAll("audit_", { max: Math.max(limit, 120) });
  const entries = await mapLimit(keys.slice(-limit).reverse(), 20, async (key) => {
    try {
      return await store.getJSON(key, null);
    } catch {
      return null;
    }
  });
  return entries
    .filter(Boolean)
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, limit);
}

function isSecureRequest(request, env) {
  try {
    return new URL(request.url).protocol === "https:" || String(env.COOKIE_SECURE || "") === "true";
  } catch {
    return false;
  }
}

async function requireAdmin(request, env) {
  const admin = await getAdminFromRequest(request, env);
  if (!admin) throw new HttpError(401, "ADMIN_REQUIRED", "请先登录管理员后台");
  return admin;
}

function assertSameOrigin(request) {
  if (!isSameOrigin(request)) throw new HttpError(403, "CSRF_BLOCKED", "请求来源校验失败");
}

function summaryStats(metas, global) {
  const now = Date.now();
  return {
    totalNotes: metas.length,
    totalChars: metas.reduce((sum, meta) => sum + (meta.size || 0), 0),
    totalViews: Math.max(global.views || 0, metas.reduce((sum, meta) => sum + (meta.views || 0), 0)),
    totalSaves: global.saves || 0,
    protectedNotes: metas.filter((meta) => meta.protected).length,
    expiringSoon: metas.filter((meta) => meta.expiresAt && meta.expiresAt > now && meta.expiresAt <= now + 3 * 24 * 60 * 60 * 1000).length,
    expiredNotes: metas.filter((meta) => meta.expired).length,
  };
}

async function trendStats(store, days = 7) {
  const now = Date.now();
  return Promise.all(
    Array.from({ length: days }, (_, index) => {
      const ms = now - (days - 1 - index) * 24 * 60 * 60 * 1000;
      return getDayStats(store, ms).then((stats) => ({
        date: new Date(ms).toISOString().slice(0, 10),
        created: stats.created || 0,
        saves: stats.saves || 0,
        views: stats.views || 0,
      }));
    }),
  );
}

async function handlePublicSite(store) {
  const settings = await loadSettings(store);
  let stats = { notes: 0 };
  try {
    if (store.available) {
      const global = await getGlobalStats(store);
      stats = { notes: global.notes || 0 };
    }
  } catch {
    // 统计失败时仍然返回站点配置
  }
  return json({ settings, stats, storageConfigured: store.available });
}

async function handleHealth(store) {
  let storageOk = false;
  let storageError = "";
  if (store.available) {
    try {
      await store.getString("__health_check__");
      storageOk = true;
    } catch (error) {
      storageError = String(error?.message || "KV 读取失败");
    }
  }
  return json({
    ok: true,
    version: VERSION,
    storageConfigured: store.available,
    storageOk,
    storageError: storageError || undefined,
    time: Date.now(),
  });
}

async function handleCreateNote(request, context, env, store) {
  assertSameOrigin(request);
  const ip = getClientIp(request);
  const limited = await rateLimit(store, "create", ip, RATE_LIMITS.create);
  if (!limited.ok) return tooMany(limited.retryAfter);
  const settings = await loadSettings(store);
  const body = await readJson(request);
  const note = await createNote(store, settings, body, { ip });
  await writeAudit(store, "note.create", { target: note.slug, ip });
  return json({ note: publicNote(note), passwordProtected: Boolean(note.pwd) }, 201);
}

async function handleGetNote(request, url, store, context) {
  const parts = parseSegments(url.pathname);
  const slug = normalizeSlug(parts[2]);
  const note = await getNoteRecord(store, slug);
  if (!note) throw new HttpError(404, "NOTE_NOT_FOUND", "这个剪贴板不存在或已经过期");
  if (note.pwd) {
    const supplied = request.headers.get("x-note-password") || "";
    if (!supplied) {
      throw new HttpError(401, "PASSWORD_REQUIRED", "这个剪贴板已加密", { passwordRequired: true });
    }
    const ok = await verifyNotePassword(note.pwd, supplied);
    if (!ok) {
      const ip = getClientIp(request);
      const limited = await rateLimit(store, "password", `${ip}:${slug}`, RATE_LIMITS.password);
      if (!limited.ok) return tooMany(limited.retryAfter);
      throw new HttpError(401, "PASSWORD_INVALID", "密码不正确", { passwordRequired: true });
    }
  }
  if (url.searchParams.get("visit") === "1") {
    const task = (async () => {
      try {
        await recordView(store, note.slug);
      } catch {
        // 浏览计数失败不影响正文
      }
    })();
    if (typeof context.waitUntil === "function") context.waitUntil(task);
    else await task;
  }
  return json({ note: publicNote(note) });
}

async function handleUpdateNote(request, url, store) {
  assertSameOrigin(request);
  const parts = parseSegments(url.pathname);
  const slug = normalizeSlug(parts[2]);
  const note = await getNoteRecord(store, slug);
  if (!note) throw new HttpError(404, "NOTE_NOT_FOUND", "这个剪贴板不存在或已经过期");
  const body = await readJson(request);
  if (note.pwd) {
    const supplied = request.headers.get("x-note-password") || body.password || "";
    await requireNotePassword(note, supplied);
  }
  const settings = await loadSettings(store);
  const updated = await updateNote(store, note, body, settings.maxNoteLength);
  return json({ note: publicNote(updated) });
}

async function handleDeleteNote(request, url, store) {
  assertSameOrigin(request);
  const parts = parseSegments(url.pathname);
  const slug = normalizeSlug(parts[2]);
  const note = await getNoteRecord(store, slug);
  if (!note) throw new HttpError(404, "NOTE_NOT_FOUND", "这个剪贴板不存在或已经过期");
  const body = await readJson(request);
  if (String(body.confirm || "") !== slug) {
    throw new HttpError(400, "CONFIRM_REQUIRED", "请输入完整的剪贴板名称以确认删除");
  }
  if (note.pwd) {
    const supplied = request.headers.get("x-note-password") || body.password || "";
    await requireNotePassword(note, supplied);
  }
  await deleteRecord(store, note, { updateStats: true });
  await writeAudit(store, "note.delete", { target: slug, ip: getClientIp(request) });
  return json({ ok: true, slug });
}

async function handleAdminLogin(request, env, store) {
  assertSameOrigin(request);
  const ip = getClientIp(request);
  const limited = await rateLimit(store, "login", ip, RATE_LIMITS.login);
  if (!limited.ok) return tooMany(limited.retryAfter);
  const config = getAdminConfig(env);
  if (!config.configured) {
    return fail(503, "ADMIN_NOT_CONFIGURED", "管理员账号尚未配置，请设置 ADMIN_PASSWORD 环境变量");
  }
  if (!store.available) {
    return fail(503, "STORAGE_NOT_CONFIGURED", "尚未绑定 CLIPBOARD_KV，无法登录后台");
  }
  const body = await readJson(request);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const ok = await verifyAdminCredentials(env, username, password);
  if (!ok) {
    await writeAudit(store, "admin.login_failed", { target: username.slice(0, 60), ip });
    // 统一的失败响应，不暴露用户名或密码哪一项错误
    return fail(401, "INVALID_CREDENTIALS", "管理员账号或密码不正确");
  }
  const session = await createSessionToken(env, config.username);
  const cookie = sessionCookie(session.token, session.maxAge, isSecureRequest(request, env));
  await writeAudit(store, "admin.login", { target: config.username, ip });
  return json(
    { authenticated: true, username: config.username, expiresAt: session.expiresAt },
    200,
    { "set-cookie": cookie },
  );
}

async function handleAdminLogout(request, env, store) {
  assertSameOrigin(request);
  const admin = await getAdminFromRequest(request, env);
  if (admin) await writeAudit(store, "admin.logout", { target: admin.username, ip: getClientIp(request) });
  return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
}

async function handleAdminStats(store) {
  const [metas, global] = await Promise.all([listAllMeta(store, { max: 3000 }), getGlobalStats(store)]);
  const stats = summaryStats(metas, global);
  const trend = await trendStats(store, 7);
  const recent = buildRecent(metas, 6);
  const top = [...metas]
    .filter((meta) => !meta.expired)
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, 5)
    .map((meta) => ({
      slug: meta.slug,
      title: meta.title || "",
      views: meta.views || 0,
      size: meta.size || 0,
      updatedAt: meta.updatedAt,
    }));
  return json({ stats, trend, recent, top, storageConfigured: store.available });
}

async function handleAdminNotes(url, store) {
  const params = url.searchParams;
  const q = String(params.get("q") || "").trim().toLowerCase().slice(0, 100);
  const filter = String(params.get("filter") || "all");
  const sort = String(params.get("sort") || "updated");
  const page = intParam(params.get("page"), 1, 1, 100000);
  const limit = intParam(params.get("limit"), 20, 5, 50);
  let metas = await listAllMeta(store, { max: 3000 });
  if (q) {
    metas = metas.filter((meta) => meta.slug.toLowerCase().includes(q) || String(meta.title || "").toLowerCase().includes(q));
  }
  if (filter === "protected") metas = metas.filter((meta) => meta.protected);
  else if (filter === "expired") metas = metas.filter((meta) => meta.expired);
  else if (filter === "public") metas = metas.filter((meta) => !meta.protected && !meta.expired);
  const sorters = {
    updated: (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0),
    created: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
    size: (a, b) => (b.size || 0) - (a.size || 0),
    views: (a, b) => (b.views || 0) - (a.views || 0),
    name: (a, b) => a.slug.localeCompare(b.slug, "zh-CN"),
  };
  metas.sort(sorters[sort] || sorters.updated);
  const total = metas.length;
  const pages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, pages);
  const items = metas.slice((safePage - 1) * limit, safePage * limit);
  return json({ items, total, page: safePage, limit, pages, truncated: total >= 3000 });
}

async function handleAdminNoteDetail(url, store) {
  const parts = parseSegments(url.pathname);
  const slug = normalizeSlug(parts[3]);
  const note = await getNoteRecord(store, slug);
  if (!note) throw new HttpError(404, "NOTE_NOT_FOUND", "剪贴板不存在或已过期");
  return json({ note: publicNote(note) });
}

async function handleAdminDeleteNote(request, url, store) {
  assertSameOrigin(request);
  const parts = parseSegments(url.pathname);
  const slug = normalizeSlug(parts[3]);
  const note = await getNoteRecord(store, slug);
  if (!note) throw new HttpError(404, "NOTE_NOT_FOUND", "剪贴板不存在或已过期");
  await deleteRecord(store, note, { updateStats: true });
  await writeAudit(store, "admin.note_delete", { target: slug, ip: getClientIp(request) });
  return json({ ok: true, slug });
}

async function handleAdminSettingsGet(store) {
  const settings = await loadSettings(store);
  return json({ settings });
}

async function handleAdminSettingsPut(request, store) {
  assertSameOrigin(request);
  const current = await loadSettings(store);
  const body = await readJson(request);
  const settings = normalizeSettings(body, current);
  await saveSettings(store, settings);
  await writeAudit(store, "admin.settings_update", { ip: getClientIp(request) });
  return json({ settings });
}

async function handleAdminAudit(store, url) {
  const limit = intParam(url.searchParams.get("limit"), 80, 1, 200);
  const entries = await listAudit(store, limit);
  return json({ entries });
}

async function handleAdminCleanup(request, store) {
  assertSameOrigin(request);
  const removed = await cleanupExpired(store);
  await writeAudit(store, "admin.cleanup", { detail: `removed=${removed}`, ip: getClientIp(request) });
  return json({ ok: true, removed });
}

async function handleAdminExport(store) {
  const metas = await listAllMeta(store, { max: 5000 });
  metas.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const header = ["slug", "title", "size_bytes", "version", "views", "protected", "expired", "created_at", "updated_at", "expires_at"];
  const rows = [header.map(csvCell).join(",")];
  for (const meta of metas) {
    rows.push([
      meta.slug,
      meta.title || "",
      meta.size || 0,
      meta.version || 0,
      meta.views || 0,
      meta.protected ? "yes" : "no",
      meta.expired ? "yes" : "no",
      meta.createdAt ? new Date(meta.createdAt).toISOString() : "",
      meta.updatedAt ? new Date(meta.updatedAt).toISOString() : "",
      meta.expiresAt ? new Date(meta.expiresAt).toISOString() : "",
    ].map(csvCell).join(","));
  }
  return new Response("\uFEFF" + rows.join("\r\n"), {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="yunclip-notes.csv"',
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function route(request, context, env) {
  const url = new URL(request.url);
  const segments = parseSegments(url.pathname);
  const store = createStore(resolveKv(env));
  const method = request.method.toUpperCase();

  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { allow: "GET,POST,PUT,DELETE,OPTIONS", "cache-control": "no-store" },
    });
  }
  if (segments[0] !== "api") throw new HttpError(404, "NOT_FOUND", "接口不存在");
  const path = segments.slice(1);

  if (path.length === 1 && path[0] === "health" && method === "GET") {
    return handleHealth(store);
  }
  if (path.length === 1 && path[0] === "site" && method === "GET") {
    return handlePublicSite(store);
  }

  if (!store.available && path[0] !== "health" && path[0] !== "site") {
    throw new HttpError(503, "STORAGE_NOT_CONFIGURED", "尚未绑定 KV 存储，请在 EdgeOne 项目中绑定 CLIPBOARD_KV");
  }

  if (path[0] === "notes") {
    if (path.length === 1 && method === "POST") return handleCreateNote(request, context, env, store);
    if (path.length === 2) {
      if (method === "GET") return handleGetNote(request, url, store, context);
      if (method === "PUT") return handleUpdateNote(request, url, store);
      if (method === "DELETE") return handleDeleteNote(request, url, store);
    }
    throw new HttpError(405, "METHOD_NOT_ALLOWED", "请求方法不支持");
  }

  if (path[0] === "admin") {
    const sub = path.slice(1);
    if (sub.length === 1 && sub[0] === "login" && method === "POST") {
      return handleAdminLogin(request, env, store);
    }
    if (sub.length === 1 && sub[0] === "logout" && method === "POST") {
      return handleAdminLogout(request, env, store);
    }
    if (sub.length === 1 && sub[0] === "session" && method === "GET") {
      const admin = await getAdminFromRequest(request, env);
      if (!admin) return fail(401, "ADMIN_REQUIRED", "未登录", { authenticated: false });
      return json({ authenticated: true, username: admin.username, expiresAt: admin.expiresAt });
    }

    const admin = await requireAdmin(request, env);
    if (method !== "GET" && method !== "HEAD") assertSameOrigin(request);

    if (sub.length === 1 && sub[0] === "stats" && method === "GET") return handleAdminStats(store);
    if (sub.length === 1 && sub[0] === "notes" && method === "GET") return handleAdminNotes(url, store);
    if (sub.length === 2 && sub[0] === "notes" && method === "GET") return handleAdminNoteDetail(url, store);
    if (sub.length === 2 && sub[0] === "notes" && method === "DELETE") return handleAdminDeleteNote(request, url, store);
    if (sub.length === 1 && sub[0] === "settings" && method === "GET") return handleAdminSettingsGet(store);
    if (sub.length === 1 && sub[0] === "settings" && method === "PUT") return handleAdminSettingsPut(request, store);
    if (sub.length === 1 && sub[0] === "audit" && method === "GET") return handleAdminAudit(store, url);
    if (sub.length === 1 && sub[0] === "cleanup" && method === "POST") return handleAdminCleanup(request, store);
    if (sub.length === 1 && sub[0] === "export" && method === "GET") return handleAdminExport(store);
    throw new HttpError(404, "NOT_FOUND", "管理接口不存在");
  }

  throw new HttpError(404, "NOT_FOUND", "接口不存在");
}

export async function handleApiRequest(context) {
  const request = context.request;
  const env = context.env || {};
  const requestId = randomHex(6);
  try {
    const response = await route(request, context, env);
    try {
      response.headers.set("x-request-id", requestId);
      response.headers.set("x-content-type-options", "nosniff");
    } catch {
      // 某些运行时可能返回不可变响应头
    }
    return response;
  } catch (error) {
    if (error instanceof HttpError) {
      return fail(error.status, error.code, error.message, error.extra);
    }
    if (error instanceof StorageUnavailableError) {
      return fail(503, "STORAGE_NOT_CONFIGURED", "尚未绑定 KV 存储，请先在 EdgeOne 项目中绑定 CLIPBOARD_KV");
    }
    console.error("yunclip api error", requestId, error);
    return fail(500, "INTERNAL_ERROR", "服务器开小差了，请稍后再试");
  }
}
