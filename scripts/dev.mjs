import { createServer as createViteServer } from "vite";
import { createDevApiServer } from "./lib/node-server.mjs";

const api = await createDevApiServer({ port: 8787 });
const vite = await createViteServer({
  server: { port: 5173, strictPort: true },
});

await vite.listen();
vite.printUrls();
console.log("  API  ->  http://127.0.0.1:8787/api");
console.log("  管理员账号由 .env 中的 ADMIN_USERNAME / ADMIN_PASSWORD 决定");

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await Promise.allSettled([
    vite.close(),
    new Promise((resolve) => api.server.close(resolve)),
  ]);
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
