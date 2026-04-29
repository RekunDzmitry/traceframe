// Code graph indexer: walks a repo, parses files with tree-sitter, persists
// files / symbols / imports / calls into Postgres under a single repo_tag.

import { readFileSync, statSync } from "node:fs";
import { dirname, resolve as pathResolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { walkFiles } from "./walker.mjs";
import { parserFor } from "./parsers/index.mjs";
import { embedBatch, vectorLiteral } from "./embedder.mjs";

const EMBED_SYMBOLS = process.env.CODEGRAPH_EMBED !== "0";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const gitHead = (rootPath) => {
  try {
    const r = spawnSync("git", ["-C", rootPath, "rev-parse", "HEAD"], {
      encoding: "utf8", timeout: 1500,
    });
    if (r.status === 0) return r.stdout.trim() || null;
  } catch {}
  return null;
};

// Resolve a JS/TS import specifier ('./foo', '../bar/baz') against a known
// file map. Returns the matched repo-relative path, or null if external/unresolvable.
const TS_RESOLVE_EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"];
const TS_INDEX_FILES = ["index.ts", "index.tsx", "index.js", "index.jsx", "index.mjs"];
const PY_RESOLVE_EXTS = ["", ".py"];

const resolveTs = (fromPath, spec, fileSet) => {
  if (!spec.startsWith(".") && !spec.startsWith("/")) return null;
  const baseDir = dirname(fromPath);
  const target = pathResolve("/" + baseDir, spec).slice(1); // normalize, strip leading /
  for (const ext of TS_RESOLVE_EXTS) {
    const candidate = (target + ext).replace(/\\/g, "/");
    if (fileSet.has(candidate)) return candidate;
  }
  for (const idx of TS_INDEX_FILES) {
    const candidate = `${target}/${idx}`.replace(/\\/g, "/");
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
};

// For Python, dotted module names (`pkg.mod.sub`) → `pkg/mod/sub.py` or
// `pkg/mod/sub/__init__.py`. Best-effort: search from repo root.
const resolvePy = (spec, fileSet) => {
  if (spec.startsWith(".")) return null; // relative imports require enclosing package context — skip for v1
  const parts = spec.split(".");
  if (!parts.length) return null;
  const base = parts.join("/");
  for (const ext of PY_RESOLVE_EXTS) {
    const c = (base + ext).replace(/\\/g, "/");
    if (fileSet.has(c)) return c;
  }
  const initPath = `${base}/__init__.py`;
  if (fileSet.has(initPath)) return initPath;
  return null;
};

const resolveImport = (lang, fromPath, spec, fileSet) => {
  if (lang === "typescript" || lang === "tsx" || lang === "javascript") return resolveTs(fromPath, spec, fileSet);
  if (lang === "python") return resolvePy(spec, fileSet);
  return null;
};

const findEnclosingSymbol = (symbols, line) => {
  // Smallest range that contains `line`. Symbols list is per-file, typically small.
  let best = null;
  let bestSpan = Infinity;
  for (const s of symbols) {
    if (s.startLine <= line && line <= s.endLine) {
      const span = s.endLine - s.startLine;
      if (span < bestSpan) { best = s; bestSpan = span; }
    }
  }
  return best;
};

export async function indexRepo(pool, repoTag, rootPath) {
  // Validate path
  let absPath;
  try {
    absPath = pathResolve(rootPath);
    const st = statSync(absPath);
    if (!st.isDirectory()) throw new Error(`not a directory: ${absPath}`);
  } catch (e) {
    await markFailed(pool, repoTag, `path invalid: ${e.message}`);
    return;
  }

  // Visible "indexing" status (committed independently so dashboard polling sees it).
  await pool.query(
    `UPDATE codegraph_repos SET status='indexing', status_error=NULL WHERE repo_tag = $1`,
    [repoTag]
  );

  const commitSha = gitHead(absPath);

  const files = [];
  for (const f of walkFiles(absPath)) {
    const parser = parserFor(f.rel);
    if (!parser) continue;
    files.push({ ...f, parser });
  }

  if (!files.length) {
    await pool.query(
      `UPDATE codegraph_repos
          SET status='ready', commit_sha=$1, file_count=0, symbol_count=0,
              lang_breakdown='{}'::jsonb, indexed_at=NOW()
        WHERE repo_tag = $2`,
      [commitSha, repoTag]
    );
    console.log(`codegraph ${repoTag}: 0 files, nothing to index`);
    return;
  }

  // Parse everything before touching the DB so a parse-time crash doesn't strand
  // a half-written repo.
  const parsed = [];
  const fileSet = new Set(files.map((f) => f.rel));
  for (const f of files) {
    let source;
    try { source = readFileSync(f.full, "utf8"); }
    catch { continue; }
    let result;
    try { result = f.parser.parse(source, f.parser.ext); }
    catch (e) {
      // Skip files the parser can't handle; log once per failure.
      console.warn(`codegraph ${repoTag}: parse failed for ${f.rel}: ${e.message}`);
      continue;
    }
    parsed.push({
      rel: f.rel,
      language: f.parser.language,
      sizeBytes: f.size,
      sha: sha256(source),
      symbols: result.symbols || [],
      imports: result.imports || [],
      calls: result.calls || [],
    });
  }

  const langBreakdown = {};
  for (const p of parsed) langBreakdown[p.language] = (langBreakdown[p.language] || 0) + 1;
  const symbolCount = parsed.reduce((s, p) => s + p.symbols.length, 0);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Wipe prior state for this repo (cascades to symbols/imports/calls).
    await client.query(`DELETE FROM codegraph_files WHERE repo_tag = $1`, [repoTag]);

    // Insert files; capture id per relative path.
    const fileIdByRel = new Map();
    if (parsed.length) {
      const repoTags = parsed.map(() => repoTag);
      const paths = parsed.map((p) => p.rel);
      const langs = parsed.map((p) => p.language);
      const sizes = parsed.map((p) => p.sizeBytes);
      const shas = parsed.map((p) => p.sha);
      const { rows } = await client.query(
        `INSERT INTO codegraph_files (repo_tag, path, language, size_bytes, sha256)
         SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::text[])
         RETURNING id, path`,
        [repoTags, paths, langs, sizes, shas]
      );
      for (const r of rows) fileIdByRel.set(r.path, Number(r.id));
    }

    // Insert symbols. Track per-file and per-(file,name) for resolution.
    const symbolsByFile = new Map(); // rel → [{ ...sym, dbId }]
    for (const p of parsed) {
      const fileId = fileIdByRel.get(p.rel);
      if (!fileId || !p.symbols.length) { symbolsByFile.set(p.rel, []); continue; }
      const n = p.symbols.length;
      const repoTags = new Array(n).fill(repoTag);
      const fileIds = new Array(n).fill(fileId);
      const names = p.symbols.map((s) => s.name);
      const qnames = p.symbols.map((s) => s.qualifiedName || null);
      const kinds = p.symbols.map((s) => s.kind);
      const startLines = p.symbols.map((s) => s.startLine);
      const endLines = p.symbols.map((s) => s.endLine);
      const sigs = p.symbols.map((s) => s.signature || null);
      const docs = p.symbols.map((s) => s.docstring || null);
      const { rows } = await client.query(
        `INSERT INTO codegraph_symbols
           (repo_tag, file_id, name, qualified_name, kind, start_line, end_line, signature, docstring)
         SELECT * FROM unnest($1::text[], $2::bigint[], $3::text[], $4::text[], $5::text[],
                              $6::int[], $7::int[], $8::text[], $9::text[])
         RETURNING id`,
        [repoTags, fileIds, names, qnames, kinds, startLines, endLines, sigs, docs]
      );
      const arr = p.symbols.map((s, i) => ({ ...s, dbId: Number(rows[i].id) }));
      symbolsByFile.set(p.rel, arr);
    }

    // Imports
    const impRepo = [], impFrom = [], impTo = [], impExt = [];
    for (const p of parsed) {
      const fromId = fileIdByRel.get(p.rel);
      if (!fromId) continue;
      for (const imp of p.imports) {
        const target = resolveImport(p.language, p.rel, imp.spec, fileSet);
        const targetId = target ? fileIdByRel.get(target) : null;
        impRepo.push(repoTag);
        impFrom.push(fromId);
        impTo.push(targetId || null);
        impExt.push(targetId ? null : imp.spec);
      }
    }
    if (impRepo.length) {
      await client.query(
        `INSERT INTO codegraph_imports (repo_tag, from_file_id, to_file_id, external_module)
         SELECT * FROM unnest($1::text[], $2::bigint[], $3::bigint[], $4::text[])`,
        [impRepo, impFrom, impTo, impExt]
      );
    }

    // Calls — best-effort same-file resolution by name.
    const callRepo = [], callFrom = [], callTo = [], callExt = [], callLine = [];
    for (const p of parsed) {
      const symList = symbolsByFile.get(p.rel) || [];
      if (!symList.length || !p.calls.length) continue;
      const byName = new Map();
      for (const s of symList) {
        if (!byName.has(s.name)) byName.set(s.name, s.dbId);
      }
      for (const call of p.calls) {
        const fromSym = findEnclosingSymbol(symList, call.line);
        if (!fromSym) continue; // call at module top-level — skip for v1
        const toId = byName.get(call.name) || null;
        callRepo.push(repoTag);
        callFrom.push(fromSym.dbId);
        callTo.push(toId);
        callExt.push(toId ? null : call.name);
        callLine.push(call.line);
      }
    }
    if (callRepo.length) {
      await client.query(
        `INSERT INTO codegraph_calls
           (repo_tag, from_symbol_id, to_symbol_id, external_name, call_site_line)
         SELECT * FROM unnest($1::text[], $2::bigint[], $3::bigint[], $4::text[], $5::int[])`,
        [callRepo, callFrom, callTo, callExt, callLine]
      );
    }

    await client.query(
      `UPDATE codegraph_repos
          SET status='ready', commit_sha=$1, file_count=$2, symbol_count=$3,
              lang_breakdown=$4::jsonb, indexed_at=NOW(), status_error=NULL
        WHERE repo_tag = $5`,
      [commitSha, parsed.length, symbolCount, JSON.stringify(langBreakdown), repoTag]
    );

    await client.query("COMMIT");
    console.log(`codegraph ${repoTag}: indexed ${parsed.length} files, ${symbolCount} symbols`);

    if (EMBED_SYMBOLS && symbolCount > 0) {
      // Embed asynchronously after the structural index is committed so the
      // dashboard flips to "ready" immediately. Embedding is the slow path.
      setImmediate(() => {
        embedSymbolsForRepo(pool, repoTag).catch((e) =>
          console.warn(`codegraph ${repoTag}: embedding failed:`, e.message)
        );
      });
    }
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch {}
    console.error(`codegraph ${repoTag}: failed`, e);
    await markFailed(pool, repoTag, e.message);
  } finally {
    client.release();
  }
}

// Build a short text representation of a symbol suitable for sentence
// embedding. Format: qualified_name + signature + docstring, joined by
// newlines. Caps the docstring at ~400 chars to keep batches fast.
const symbolText = (s) => {
  const head = s.qualified_name || s.name || "";
  const sig = (s.signature || "").trim();
  const doc = (s.docstring || "").trim().slice(0, 400);
  return [head, sig, doc].filter(Boolean).join("\n");
};

async function embedSymbolsForRepo(pool, repoTag) {
  const startedAt = Date.now();
  // Pull all symbols for this repo that don't yet have an embedding.
  const { rows } = await pool.query(
    `SELECT id, name, qualified_name, signature, docstring
       FROM codegraph_symbols
      WHERE repo_tag = $1 AND embedding IS NULL`,
    [repoTag]
  );
  if (!rows.length) return;
  console.log(`codegraph ${repoTag}: embedding ${rows.length} symbols…`);

  const CHUNK = 64; // DB write chunk; embedder internally batches at 32.
  let done = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const texts = chunk.map(symbolText);
    const vecs = await embedBatch(texts);
    const ids = chunk.map((r) => Number(r.id));
    const literals = vecs.map(vectorLiteral);
    // unnest both arrays in lockstep, cast each text → vector(384).
    await pool.query(
      `UPDATE codegraph_symbols AS s
          SET embedding = v.lit::vector
         FROM (SELECT * FROM unnest($1::bigint[], $2::text[]) AS u(id, lit)) v
        WHERE s.id = v.id`,
      [ids, literals]
    );
    done += chunk.length;
  }
  const ms = Date.now() - startedAt;
  console.log(`codegraph ${repoTag}: embedded ${done} symbols in ${ms}ms`);
}

async function markFailed(pool, repoTag, message) {
  try {
    await pool.query(
      `UPDATE codegraph_repos
          SET status='failed', status_error=$1
        WHERE repo_tag = $2`,
      [String(message || "unknown").slice(0, 500), repoTag]
    );
  } catch (e) {
    console.error(`codegraph ${repoTag}: markFailed itself failed:`, e.message);
  }
}

