// Language registry: maps file extension → parser + canonical language name.

import { parse as parseTS } from "./typescript.mjs";
import { parse as parsePY } from "./python.mjs";

const EXT_MAP = {
  ts:  { language: "typescript", parse: (src, ext) => parseTS(src, ext) },
  mts: { language: "typescript", parse: (src, ext) => parseTS(src, ext) },
  cts: { language: "typescript", parse: (src, ext) => parseTS(src, ext) },
  tsx: { language: "tsx",        parse: (src, ext) => parseTS(src, ext) },
  js:  { language: "javascript", parse: (src, ext) => parseTS(src, ext) },
  mjs: { language: "javascript", parse: (src, ext) => parseTS(src, ext) },
  cjs: { language: "javascript", parse: (src, ext) => parseTS(src, ext) },
  jsx: { language: "javascript", parse: (src, ext) => parseTS(src, ext) },
  py:  { language: "python",     parse: (src) => parsePY(src) },
};

export const extOf = (path) => {
  const i = path.lastIndexOf(".");
  if (i < 0) return null;
  return path.slice(i + 1).toLowerCase();
};

export const parserFor = (path) => {
  const ext = extOf(path);
  if (!ext) return null;
  const entry = EXT_MAP[ext];
  if (!entry) return null;
  return { ext, language: entry.language, parse: entry.parse };
};
