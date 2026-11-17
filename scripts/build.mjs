import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import { rollup } from "rollup";
import { minify } from "terser";
import ts from "typescript";

const root = process.cwd();
const dist = path.join(root, "dist");
const publicDir = path.join(root, "public");
let cssBuffer = "";

const typescriptPlugin = {
  name: "yunclip-typescript",
  transform(code, id) {
    if (!/\.(ts|tsx)$/.test(id) || id.includes("node_modules")) return null;
    const result = ts.transpileModule(code, {
      fileName: id,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        isolatedModules: true,
        sourceMap: false,
      },
    });
    return { code: result.outputText, map: null };
  },
};

const cssPlugin = {
  name: "yunclip-css",
  transform(code, id) {
    if (!id.endsWith(".css")) return null;
    cssBuffer += `\n/* ${path.basename(id)} */\n${code}`;
    return { code: "export default {};", map: null };
  },
};

const envPlugin = {
  name: "yunclip-env",
  transform(code) {
    if (!code.includes("process.env.NODE_ENV")) return null;
    return { code: code.replaceAll("process.env.NODE_ENV", JSON.stringify("production")), map: null };
  },
};

const minifyPlugin = {
  name: "yunclip-minify",
  async renderChunk(code) {
    const result = await minify(code, {
      compress: { passes: 2 },
      mangle: true,
      format: { comments: false },
    });
    return { code: result.code ?? code, map: null };
  },
};

function copyDirectory(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyDirectory(from, to);
    else fs.copyFileSync(from, to);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, "assets"), { recursive: true });

const bundle = await rollup({
  input: path.join(root, "src/main.tsx"),
  plugins: [
    typescriptPlugin,
    envPlugin,
    nodeResolve({ browser: true, extensions: [".mjs", ".js", ".json", ".ts", ".tsx"] }),
    commonjs({ include: /node_modules/, transformMixedEsModules: true }),
    cssPlugin,
    minifyPlugin,
  ],
  onwarn(warning) {
    if (["CIRCULAR_DEPENDENCY", "THIS_IS_UNDEFINED", "EVAL", "MODULE_LEVEL_DIRECTIVE"].includes(warning.code)) return;
    console.warn(warning.message);
  },
});

const output = await bundle.write({
  dir: dist,
  format: "es",
  inlineDynamicImports: true,
  entryFileNames: "assets/app.[hash].js",
  chunkFileNames: "assets/[name]-[hash].js",
  assetFileNames: "assets/[name]-[hash][extname]",
});
await bundle.close();

const entry = output.output.find((item) => item.type === "chunk" && item.isEntry);
if (!entry) throw new Error("没有生成入口 bundle");

const cssHash = createHash("sha256").update(cssBuffer).digest("hex").slice(0, 10);
const cssName = `assets/app.${cssHash}.css`;
fs.writeFileSync(path.join(dist, cssName), cssBuffer, "utf8");

copyDirectory(publicDir, dist);

const template = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptPattern = /\s*<script type="module" src="\/src\/main\.tsx"><\/script>/;
if (!scriptPattern.test(template)) throw new Error("index.html 中找不到 Vite 入口脚本");
let html = template.replace(
  scriptPattern,
  `\n    <script type="module" src="/${entry.fileName}"></script>`,
);
html = html.replace("</head>", `    <link rel="stylesheet" href="/${cssName}" />\n  </head>`);
fs.writeFileSync(path.join(dist, "index.html"), html, "utf8");

const jsSize = entry.code.length;
console.log(`build  ✓  ${entry.fileName} (${formatBytes(jsSize)})`);
console.log(`build  ✓  ${cssName} (${formatBytes(cssBuffer.length)})`);
console.log(`build  ✓  dist/index.html`);
