// TypeScript / JavaScript symbol+import+call extractor (tree-sitter).

import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import JavaScript from "tree-sitter-javascript";

const tsLang = TypeScript.typescript;
const tsxLang = TypeScript.tsx;
const jsLang = JavaScript;

const parserCache = new Map();
const getParser = (language) => {
  let p = parserCache.get(language);
  if (!p) { p = new Parser(); p.setLanguage(language); parserCache.set(language, p); }
  return p;
};

const langForExt = (ext) => {
  if (ext === "ts" || ext === "mts" || ext === "cts") return tsLang;
  if (ext === "tsx") return tsxLang;
  return jsLang; // .js, .mjs, .cjs, .jsx
};

const lineOf = (node) => (node.startPosition?.row ?? 0) + 1;
const endLineOf = (node) => (node.endPosition?.row ?? lineOf(node) - 1) + 1;

const truncSig = (s, n = 200) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

const collectSymbols = (root) => {
  const symbols = [];
  const stack = [{ node: root, classCtx: null }];
  while (stack.length) {
    const { node, classCtx } = stack.pop();

    if (node.type === "function_declaration" || node.type === "generator_function_declaration") {
      const name = node.childForFieldName?.("name")?.text;
      if (name) {
        symbols.push({
          name, qualifiedName: name, kind: "function",
          startLine: lineOf(node), endLine: endLineOf(node),
          signature: truncSig(node.text.split("\n")[0]),
        });
      }
    } else if (node.type === "class_declaration" || node.type === "abstract_class_declaration") {
      const name = node.childForFieldName?.("name")?.text;
      if (name) {
        symbols.push({
          name, qualifiedName: name, kind: "class",
          startLine: lineOf(node), endLine: endLineOf(node),
          signature: truncSig(`class ${name}`),
        });
        // Recurse into class body with new classCtx
        const body = node.childForFieldName?.("body");
        if (body) {
          for (let i = body.namedChildCount - 1; i >= 0; i--) {
            stack.push({ node: body.namedChild(i), classCtx: name });
          }
          continue;
        }
      }
    } else if (node.type === "method_definition") {
      const name = node.childForFieldName?.("name")?.text;
      if (name) {
        const qn = classCtx ? `${classCtx}.${name}` : name;
        symbols.push({
          name, qualifiedName: qn, kind: "method",
          startLine: lineOf(node), endLine: endLineOf(node),
          signature: truncSig(node.text.split("\n")[0]),
        });
      }
    } else if (node.type === "interface_declaration" || node.type === "type_alias_declaration") {
      const name = node.childForFieldName?.("name")?.text;
      if (name) {
        symbols.push({
          name, qualifiedName: name,
          kind: node.type === "interface_declaration" ? "interface" : "type",
          startLine: lineOf(node), endLine: endLineOf(node),
          signature: truncSig(node.text.split("\n")[0]),
        });
      }
    } else if (node.type === "lexical_declaration" || node.type === "variable_declaration") {
      // Capture top-level `const fn = () => …` style as functions/variables.
      // Only at file scope (not inside other functions) to keep noise down.
      for (let i = 0; i < node.namedChildCount; i++) {
        const decl = node.namedChild(i);
        if (decl.type !== "variable_declarator") continue;
        const nameNode = decl.childForFieldName?.("name");
        const valueNode = decl.childForFieldName?.("value");
        if (!nameNode || nameNode.type !== "identifier") continue;
        const name = nameNode.text;
        const isFn = valueNode && (
          valueNode.type === "arrow_function" ||
          valueNode.type === "function_expression" ||
          valueNode.type === "function" ||
          valueNode.type === "generator_function"
        );
        symbols.push({
          name, qualifiedName: name,
          kind: isFn ? "function" : "variable",
          startLine: lineOf(node), endLine: endLineOf(node),
          signature: truncSig(node.text.split("\n")[0]),
        });
      }
    }

    for (let i = node.namedChildCount - 1; i >= 0; i--) {
      stack.push({ node: node.namedChild(i), classCtx });
    }
  }
  return symbols;
};

const collectImports = (root) => {
  const imports = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (node.type === "import_statement") {
      const src = node.childForFieldName?.("source");
      if (src && src.type === "string") {
        const raw = src.text;
        const spec = raw.replace(/^['"`]|['"`]$/g, "");
        if (spec) imports.push({ spec, line: lineOf(node) });
      }
    } else if (node.type === "call_expression") {
      // require('x') / import('x')
      const fn = node.childForFieldName?.("function");
      const args = node.childForFieldName?.("arguments");
      if (fn && args && (fn.text === "require" || fn.type === "import")) {
        const first = args.namedChild(0);
        if (first && first.type === "string") {
          const spec = first.text.replace(/^['"`]|['"`]$/g, "");
          if (spec) imports.push({ spec, line: lineOf(node) });
        }
      }
    }
    for (let i = node.namedChildCount - 1; i >= 0; i--) stack.push(node.namedChild(i));
  }
  return imports;
};

const collectCalls = (root) => {
  const calls = [];
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (node.type === "call_expression") {
      const fn = node.childForFieldName?.("function");
      let name = null;
      if (fn) {
        if (fn.type === "identifier") name = fn.text;
        else if (fn.type === "member_expression") {
          const prop = fn.childForFieldName?.("property");
          if (prop) name = prop.text;
        }
      }
      if (name) calls.push({ name, line: lineOf(node) });
    }
    for (let i = node.namedChildCount - 1; i >= 0; i--) stack.push(node.namedChild(i));
  }
  return calls;
};

// Default buffer is ~32KB which fails on real source files.
const PARSE_OPTS = { bufferSize: 8 * 1024 * 1024 };

export function parse(source, ext) {
  const language = langForExt(ext);
  const parser = getParser(language);
  const tree = parser.parse(source, undefined, PARSE_OPTS);
  const root = tree.rootNode;
  return {
    symbols: collectSymbols(root),
    imports: collectImports(root),
    calls: collectCalls(root),
  };
}
