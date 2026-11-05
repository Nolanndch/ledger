// node:path (POSIX), réduit.
export const sep = "/";
export function normalize(p) {
  const abs = p.startsWith("/"), out = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { if (out.length && out.at(-1) !== "..") out.pop(); else if (!abs) out.push(".."); }
    else out.push(part);
  }
  return (abs ? "/" : "") + out.join("/") || (abs ? "/" : ".");
}
export const join = (...parts) => normalize(parts.filter(Boolean).join("/"));
export const resolve = (...parts) => normalize(parts.reduce((a, p) => (p.startsWith("/") ? p : a + "/" + p), "/"));
export const dirname = (p) => { const n = normalize(p); const i = n.lastIndexOf("/"); return i > 0 ? n.slice(0, i) : i === 0 ? "/" : "."; };
export const basename = (p, ext) => { const b = normalize(p).split("/").pop(); return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b; };
export const extname = (p) => { const b = basename(p); const i = b.lastIndexOf("."); return i > 0 ? b.slice(i) : ""; };
export default { sep, normalize, join, resolve, dirname, basename, extname };
