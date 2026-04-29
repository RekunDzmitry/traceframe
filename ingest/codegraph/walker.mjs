// Filesystem walker for codegraph indexing.
//
// Yields repo-relative paths for files that should be indexed.
// Honors .gitignore plus a built-in skip list of vendored / generated trees.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ignore from "ignore";

const ALWAYS_SKIP = [
  "node_modules", ".git", "dist", "build", ".next", "target",
  ".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache",
  ".cache", "coverage", ".turbo", ".parcel-cache", ".vercel",
  ".gitnexus", ".obsidian",
];

const MAX_FILE_BYTES = 2 * 1024 * 1024; // skip > 2MB files

const buildIgnorer = (rootPath) => {
  const ig = ignore();
  ig.add(ALWAYS_SKIP);
  try {
    const text = readFileSync(join(rootPath, ".gitignore"), "utf8");
    ig.add(text);
  } catch {}
  return ig;
};

export function* walkFiles(rootPath) {
  const ig = buildIgnorer(rootPath);
  const stack = [rootPath];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      const full = join(dir, e.name);
      const rel = relative(rootPath, full).split(sep).join("/");
      if (!rel) continue;
      // ignore lib needs trailing slash for directory matches
      const test = e.isDirectory() ? `${rel}/` : rel;
      if (ig.ignores(test)) continue;
      if (e.isDirectory()) { stack.push(full); continue; }
      if (!e.isFile()) continue;
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.size > MAX_FILE_BYTES) continue;
      yield { rel, full, size: st.size };
    }
  }
}
