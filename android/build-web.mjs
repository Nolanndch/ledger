// Prépare les fichiers web de l'app : l'interface (public/), le moteur (runtime.js et le code du serveur,
// regroupés par esbuild) et SQLite compilé en WebAssembly.
// Usage : node build-web.mjs <dossier de sortie>
import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const HERE = import.meta.dirname, ROOT = path.join(HERE, "..");
const OUT = path.resolve(process.argv[2] || path.join(ROOT, "build/android/assets/www"));
const version = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, "public"), OUT, { recursive: true, filter: (src) => !src.endsWith("sw.js") && !src.endsWith(".webmanifest") });
fs.copyFileSync(path.join(HERE, "node_modules/sql.js/dist/sql-wasm-browser.wasm"), path.join(OUT, "sql-wasm-browser.wasm"));

// Le moteur se charge avant l'interface (script classique, exécuté avant les modules).
const index = path.join(OUT, "index.html");
const html = fs.readFileSync(index, "utf8").replace('<script type="module" src="js/main.js">', '<script src="android-runtime.js"></script>\n<script type="module" src="js/main.js">');
if (!html.includes("android-runtime.js")) throw new Error("index.html : point d'insertion du moteur introuvable");
fs.writeFileSync(index, html.replace(/<link rel="manifest"[^>]*>\n?/, ""));

const SHIMS = { fs: "fs.js", path: "path.js", os: "os.js", crypto: "crypto.js", sqlite: "sqlite.js", http: "unavailable.js", dgram: "unavailable.js", child_process: "unavailable.js", url: "unavailable.js" };
await build({
  entryPoints: [path.join(HERE, "web/runtime.js")],
  outfile: path.join(OUT, "android-runtime.js"),
  bundle: true, format: "iife", platform: "browser", target: "chrome110", minify: true, legalComments: "none",
  define: { __LEDGER_VERSION__: JSON.stringify(version) },
  plugins: [{
    name: "node-shims",
    setup(b) {
      b.onResolve({ filter: /^(node:)?(fs|path|os|crypto|sqlite|http|dgram|child_process|url)$/ }, (args) => ({ path: path.join(HERE, "web/shims", SHIMS[args.path.replace(/^node:/, "")]) }));
    },
  }],
  logLevel: "warning",
});
console.log(`Fichiers web prêts : ${path.relative(ROOT, OUT)} (Ledger ${version})`);
