import { createPreviewServer } from "./lib/node-server.mjs";

const preview = await createPreviewServer({ port: 4173 });
console.log(`预览地址: http://127.0.0.1:${preview.port}`);
console.log("本地管理员账号由 .env 中的 ADMIN_USERNAME / ADMIN_PASSWORD 决定");

let closing = false;
function shutdown() {
  if (closing) return;
  closing = true;
  preview.server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
