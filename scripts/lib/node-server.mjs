import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { handleApiRequest } from "../../server/app.js";
import { FileKV } from "./file-kv.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

export function loadEnv(file = path.join(ROOT, ".env")) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const index = line.indexOf("=");
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1_000_000) throw new Error("body too large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function requestHeaders(req) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) headers.set(key, value.join(", "));
    else headers.set(key, value);
  }
  if (!headers.has("x-real-ip")) headers.set("x-real-ip", req.socket.remoteAddress || "127.0.0.1");
  return headers;
}

export async function nodeRequestToWeb(req) {
  const host = req.headers.host || "127.0.0.1";
  const method = (req.method || "GET").toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await readBody(req);
  return new Request(`http://${host}${req.url || "/"}`, {
    method,
    headers: requestHeaders(req),
    body,
  });
}

export async function writeWebResponse(res, response) {
  const headers = {};
  for (const [key, value] of response.headers) headers[key] = value;
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (cookies.length) headers["set-cookie"] = cookies;
  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, headers);
  res.end(body);
}

export function createApiHandler(kv) {
  return async (req, res) => {
    try {
      if (!req.url?.startsWith("/api")) {
        res.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "接口不存在" } }));
        return;
      }
      const request = await nodeRequestToWeb(req);
      const context = {
        request,
        env: { ...process.env, CLIPBOARD_KV: kv },
        waitUntil: (promise) => {
          Promise.resolve(promise).catch(() => {});
        },
      };
      const response = await handleApiRequest(context);
      await writeWebResponse(res, response);
    } catch (error) {
      console.error("[dev api]", error);
      if (!res.headersSent) {
        res.writeHead(error?.message === "body too large" ? 413 : 500, { "content-type": "application/json; charset=utf-8" });
      }
      res.end(JSON.stringify({ error: { code: "SERVER_ERROR", message: "本地 API 执行失败" } }));
    }
  };
}

export async function createDevApiServer({ port = 8787, dataFile = path.join(ROOT, ".dev-kv.json") } = {}) {
  loadEnv();
  if (!process.env.ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD_SHA256) {
    process.env.ADMIN_USERNAME ||= "admin";
    process.env.ADMIN_PASSWORD = "dev-password";
    process.env.SESSION_SECRET ||= "dev-session-secret-change-before-deploy";
    console.warn("[dev] 未配置管理员密码，已使用 admin / dev-password");
  }
  const kv = new FileKV(dataFile);
  const server = http.createServer(createApiHandler(kv));
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return { server, kv, port };
}

export async function createPreviewServer({ port = 4173, dataFile = path.join(ROOT, ".dev-kv.json") } = {}) {
  loadEnv();
  if (!process.env.ADMIN_PASSWORD && !process.env.ADMIN_PASSWORD_SHA256) {
    process.env.ADMIN_USERNAME ||= "admin";
    process.env.ADMIN_PASSWORD = "dev-password";
    process.env.SESSION_SECRET ||= "dev-session-secret-change-before-deploy";
    console.warn("[dev] 未配置管理员密码，已使用 admin / dev-password");
  }
  const kv = new FileKV(dataFile);
  const api = createApiHandler(kv);
  const dist = path.join(ROOT, "dist");
  if (!fs.existsSync(path.join(dist, "index.html"))) {
    throw new Error("dist/index.html 不存在，请先执行 npm run build");
  }
  const server = http.createServer(async (req, res) => {
    if (req.url?.startsWith("/api")) return api(req, res);
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === "/") pathname = "/index.html";
      let filePath = path.resolve(dist, "." + pathname);
      if (!filePath.startsWith(dist)) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      let stat = null;
      try {
        stat = fs.statSync(filePath);
      } catch {
        stat = null;
      }
      if (stat?.isDirectory()) {
        filePath = path.join(filePath, "index.html");
        stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
      }
      if (!stat && pathname.startsWith("/assets/")) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      if (!stat) {
        filePath = path.join(dist, "index.html");
        stat = fs.statSync(filePath);
      }
      const ext = path.extname(filePath).toLowerCase();
      const headers = {
        "content-type": MIME[ext] || "application/octet-stream",
        "content-length": stat.size,
        "x-content-type-options": "nosniff",
      };
      if (pathname.startsWith("/assets/")) headers["cache-control"] = "public, max-age=31536000, immutable";
      else headers["cache-control"] = "no-cache";
      res.writeHead(200, headers);
      if (req.method === "HEAD") res.end();
      else fs.createReadStream(filePath).pipe(res);
    } catch (error) {
      console.error("[preview]", error);
      res.writeHead(500);
      res.end("Preview server error");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return { server, kv, port };
}
