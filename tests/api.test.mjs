import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { handleApiRequest } from "../server/app.js";
import { MemoryKV } from "../server/store.js";

const BASE = "https://yunclip.test";
const ADMIN = {
  ADMIN_USERNAME: "admin",
  ADMIN_PASSWORD: "a-very-long-test-password",
  SESSION_SECRET: "test-session-secret-at-least-16-chars",
};

function makeEnv(kv, extra = {}) {
  return { CLIPBOARD_KV: kv, ...ADMIN, ...extra };
}

async function call(kv, path, options = {}) {
  const { method = "GET", body, headers = {}, env = {} } = options;
  const h = new Headers(headers);
  let payload;
  if (body !== undefined) {
    h.set("content-type", "application/json");
    payload = JSON.stringify(body);
  }
  const request = new Request(BASE + path, { method, headers: h, body: payload });
  const context = { request, env: makeEnv(kv, env), waitUntil: (promise) => promise.catch(() => {}) };
  const response = await handleApiRequest(context);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: response.status, data, headers: response.headers, text };
}

function cookieFrom(response) {
  const raw = response.headers.get("set-cookie") || "";
  return raw.split(";")[0];
}

test("health and site work before KV is configured", async () => {
  const kv = null;
  const health = await call(kv, "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.data.storageConfigured, false);

  const site = await call(kv, "/api/site");
  assert.equal(site.status, 200);
  assert.equal(site.data.settings.siteName, "云夹");
  assert.equal(site.data.storageConfigured, false);
});

test("create, read, update and conflict detection", async () => {
  const kv = new MemoryKV();
  const created = await call(kv, "/api/notes", {
    method: "POST",
    body: { slug: "hello-world", title: "第一条", content: "你好，云夹\n第二行" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.note.slug, "hello-world");
  assert.equal(created.data.note.version, 1);
  assert.equal(created.data.note.size > 0, true);

  const read = await call(kv, "/api/notes/hello-world");
  assert.equal(read.status, 200);
  assert.equal(read.data.note.content, "你好，云夹\n第二行");
  assert.equal(read.data.note.protected, false);

  await call(kv, "/api/notes/hello-world?visit=1");
  await new Promise((resolve) => setTimeout(resolve, 30));
  const afterView = await call(kv, "/api/notes/hello-world");
  assert.equal(afterView.data.note.views >= 1, true);

  const updated = await call(kv, "/api/notes/hello-world", {
    method: "PUT",
    body: { content: "更新后的内容", version: 1 },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.note.version, 2);
  assert.equal(updated.data.note.content, "更新后的内容");

  const conflict = await call(kv, "/api/notes/hello-world", {
    method: "PUT",
    body: { content: "旧版本覆盖", version: 1 },
  });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.data.error.code, "VERSION_CONFLICT");

  const duplicate = await call(kv, "/api/notes", {
    method: "POST",
    body: { slug: "hello-world", content: "重复" },
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.data.error.code, "SLUG_TAKEN");
});

test("password-protected notes require the correct password", async () => {
  const kv = new MemoryKV();
  const created = await call(kv, "/api/notes", {
    method: "POST",
    body: { slug: "secret-note", content: "机密内容", password: "open-sesame" },
  });
  assert.equal(created.status, 201);
  assert.equal(created.data.note.protected, true);

  const missing = await call(kv, "/api/notes/secret-note");
  assert.equal(missing.status, 401);
  assert.equal(missing.data.error.code, "PASSWORD_REQUIRED");

  const wrong = await call(kv, "/api/notes/secret-note", { headers: { "x-note-password": "wrong" } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.data.error.code, "PASSWORD_INVALID");

  const correct = await call(kv, "/api/notes/secret-note", { headers: { "x-note-password": "open-sesame" } });
  assert.equal(correct.status, 200);
  assert.equal(correct.data.note.content, "机密内容");
});

test("admin login, session, dashboard, settings and deletion", async () => {
  const kv = new MemoryKV();
  await call(kv, "/api/notes", { method: "POST", body: { slug: "admin-test", title: "后台测试", content: "abc" } });

  const bad = await call(kv, "/api/admin/login", {
    method: "POST",
    body: { username: "admin", password: "wrong" },
  });
  assert.equal(bad.status, 401);

  const good = await call(kv, "/api/admin/login", {
    method: "POST",
    body: { username: "admin", password: ADMIN.ADMIN_PASSWORD },
  });
  assert.equal(good.status, 200);
  assert.equal(good.data.authenticated, true);
  const cookie = cookieFrom(good);
  assert.match(cookie, /^yunclip_admin=/);

  const session = await call(kv, "/api/admin/session", { headers: { cookie } });
  assert.equal(session.status, 200);
  assert.equal(session.data.username, "admin");

  const stats = await call(kv, "/api/admin/stats", { headers: { cookie } });
  assert.equal(stats.status, 200);
  assert.equal(stats.data.stats.totalNotes, 1);
  assert.equal(stats.data.trend.length, 7);

  const list = await call(kv, "/api/admin/notes?q=admin", { headers: { cookie } });
  assert.equal(list.status, 200);
  assert.equal(list.data.total, 1);
  assert.equal(list.data.items[0].slug, "admin-test");

  const detail = await call(kv, "/api/admin/notes/admin-test", { headers: { cookie } });
  assert.equal(detail.status, 200);
  assert.equal(detail.data.note.content, "abc");

  const saved = await call(kv, "/api/admin/settings", {
    method: "PUT",
    headers: { cookie },
    body: { siteName: "我的云夹", allowCreate: false, maxNoteLength: 5000, defaultExpiry: "7d" },
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.settings.siteName, "我的云夹");
  assert.equal(saved.data.settings.updatedAt > 0, true);
  const publicSite = await call(kv, "/api/site");
  assert.equal(publicSite.data.settings.siteName, "我的云夹");
  assert.equal(publicSite.data.settings.updatedAt, saved.data.settings.updatedAt);

  const blocked = await call(kv, "/api/notes", { method: "POST", body: { slug: "blocked", content: "x" } });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.data.error.code, "CREATE_DISABLED");

  const deleted = await call(kv, "/api/admin/notes/admin-test", { method: "DELETE", headers: { cookie } });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.ok, true);

  const gone = await call(kv, "/api/notes/admin-test");
  assert.equal(gone.status, 404);
});

test("public delete needs the slug confirmation and correct password", async () => {
  const kv = new MemoryKV();
  await call(kv, "/api/notes", {
    method: "POST",
    body: { slug: "delete-me", content: "bye", password: "delete-pass" },
  });

  const unconfirmed = await call(kv, "/api/notes/delete-me", {
    method: "DELETE",
    headers: { "x-note-password": "delete-pass" },
    body: { confirm: "wrong" },
  });
  assert.equal(unconfirmed.status, 400);

  const noPassword = await call(kv, "/api/notes/delete-me", {
    method: "DELETE",
    body: { confirm: "delete-me" },
  });
  assert.equal(noPassword.status, 401);

  const deleted = await call(kv, "/api/notes/delete-me", {
    method: "DELETE",
    headers: { "x-note-password": "delete-pass" },
    body: { confirm: "delete-me" },
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.data.ok, true);
});

test("EdgeOne global KV binding and SHA-256 admin password are supported", async () => {
  const kv = new MemoryKV();
  globalThis.CLIPBOARD_KV = kv;
  try {
    const health = await call(kv, "/api/health", { env: { CLIPBOARD_KV: undefined } });
    assert.equal(health.status, 200);
    assert.equal(health.data.storageConfigured, true);
  } finally {
    delete globalThis.CLIPBOARD_KV;
  }

  const password = "hashed-admin-password";
  const hash = createHash("sha256").update(password).digest("hex");
  const login = await call(kv, "/api/admin/login", {
    method: "POST",
    body: { username: "admin", password },
    env: { ADMIN_PASSWORD: "", ADMIN_PASSWORD_SHA256: hash },
  });
  assert.equal(login.status, 200);
  assert.equal(login.data.authenticated, true);
});

test("reserved slugs, unicode names and content limits", async () => {
  const kv = new MemoryKV();
  const reserved = await call(kv, "/api/notes", { method: "POST", body: { slug: "admin", content: "x" } });
  assert.equal(reserved.status, 409);
  assert.equal(reserved.data.error.code, "SLUG_RESERVED");

  const invalid = await call(kv, "/api/notes", { method: "POST", body: { slug: "a/b", content: "x" } });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.data.error.code, "INVALID_SLUG");

  const unicode = await call(kv, "/api/notes", { method: "POST", body: { slug: "我的便签", content: "中文内容" } });
  assert.equal(unicode.status, 201);
  const unicodeRead = await call(kv, "/api/notes/%E6%88%91%E7%9A%84%E4%BE%BF%E7%AD%BE");
  assert.equal(unicodeRead.status, 200);
  assert.equal(unicodeRead.data.note.content, "中文内容");

  const tooLong = await call(kv, "/api/notes", { method: "POST", body: { content: "x".repeat(200_001) } });
  assert.equal(tooLong.status, 413);
  assert.equal(tooLong.data.error.code, "CONTENT_TOO_LARGE");
});
