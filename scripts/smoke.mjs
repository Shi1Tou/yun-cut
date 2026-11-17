const base = process.env.SMOKE_BASE || "http://127.0.0.1:4173";
const adminUsername = process.env.SMOKE_ADMIN_USERNAME || process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.SMOKE_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "dev-password";

async function get(path, options) {
  const response = await fetch(base + path, options);
  const text = await response.text();
  return { status: response.status, type: response.headers.get("content-type"), text: text.slice(0, 500) };
}

async function main() {
  console.log("health", await get("/api/health"));
  console.log("home", await get("/"));
  console.log("spa", await get("/n/demo"));
  console.log("admin", await get("/admin"));
  console.log("missing-asset", await get("/assets/nope.js"));

  const login = await fetch(base + "/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
  });
  const loginText = await login.text();
  const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
  console.log("login", login.status, loginText.slice(0, 300), "cookie", cookie.slice(0, 50));

  console.log("session", await get("/api/admin/session", { headers: { cookie } }));

  const create = await fetch(base + "/api/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug: "demo-preview", title: "预览测试", content: "你好，云夹！\n这是本地预览。" }),
  });
  console.log("create", create.status, (await create.text()).slice(0, 300));
  console.log("note", await get("/api/notes/demo-preview"));
  console.log("admin-stats", await get("/api/admin/stats", { headers: { cookie } }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
