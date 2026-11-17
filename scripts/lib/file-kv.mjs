import fs from "node:fs";
import path from "node:path";
import { MemoryKV } from "../../server/store.js";

export class FileKV extends MemoryKV {
  constructor(filePath) {
    let initial = {};
    try {
      if (fs.existsSync(filePath)) initial = JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch {
      initial = {};
    }
    super(initial);
    this.filePath = filePath;
    this.timer = null;
  }

  scheduleSave() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        fs.writeFileSync(this.filePath, JSON.stringify(Object.fromEntries(this.map), null, 2));
      } catch (error) {
        console.warn("[dev] 无法写入本地 KV:", error.message);
      }
    }, 60);
  }

  async put(key, value) {
    await super.put(key, value);
    this.scheduleSave();
  }

  async delete(key) {
    await super.delete(key);
    this.scheduleSave();
  }
}
