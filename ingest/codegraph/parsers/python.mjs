// Python symbol+import+call extractor (tree-sitter).

import Parser from "tree-sitter";
import Python from "tree-sitter-python";

let parserInstance = null;
const getParser = () => {
  if (!parserInstance) { parserInstance = new Parser(); parserInstance.setLanguage(Python); }
  return parserInstance;
};

const lineOf = (node) => (node.startPosition?.row ?? 0) + 1;
const endLineOf = (node) => (node.endPosition?.row ?? lineOf(node) - 1) + 1;

const truncSig = (s, n = 200) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

const docstringFor = (node) => {
  // Python convention: first statement of a function/class body is a string expression.
  const body = node.childForFieldName?.("body");
  if (!body) return null;
  const first = body.namedChild(0);
  if (!first) return null;
  if (first.type === "expression_statement") {
    const expr = first.namedChild(0);
    if (expr && expr.type === "string") {
      return truncSig(expr.text.replace(/^['"]{1,3}|['"]{1,3}$/g, ""), 400);
    }
  }
  return null;
};

const collectSymbols = (root) => {
  const symbols = [];
  const stack = [{ node: root, classCtx: null }];
  while (stack.length) {
    const { node, classCtx } = stack.pop();
    if (node.type === "function_definition" || node.type === "async_function_definition") {
      const nameNode = node.childForFieldName?.("name");
      if (nameNode) {
        const name = nameNode.text;
        const qn = classCtx ? `${classCtx}.${name}` : name;
        symbols.push({
          name, qualifiedName: qn,
          kind: classCtx ? "method" : "function",
          startLine: lineOf(node), endLine: endLineOf(node),
          signature: truncSig(node.text.split("\n")[0]),
          docstring: docstringFor(node),
        });
      }
    } else if (node.type === "class_definition") {
      const nameNode = node.childForFieldName?.("name");
      if (nameNode) {
        const name = nameNode.text;
        symbols.push({
          name, qualifiedName: name, kind: "class",
          startLine: lineOf(node), endLine: endLineOf(node),
          signature: truncSig(node.text.split("\n")[0]),
          docstring: docstringFor(node),
        });
        const body = node.childForFieldName?.("body");
        if (body) {
          for (let i = body.namedChildCount - 1; i >= 0; i--) {
            stack.push({ node: body.namedChild(i), classCtx: name });
          }
          continue;
        }
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
      // import a, b.c
      for (let i = 0; i < node.namedChildCount; i++) {
        const c = node.namedChild(i);
        if (c.type === "dotted_name" || c.type === "aliased_import") {
          const target = c.type === "aliased_import" ? c.childForFieldName?.("name") : c;
          if (target) imports.push({ spec: target.text, line: lineOf(node) });
        }
      }
    } else if (node.type === "import_from_statement") {
      const moduleNode = node.childForFieldName?.("module_name");
      if (moduleNode) imports.push({ spec: moduleNode.text, line: lineOf(node) });
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
    if (node.type === "call") {
      const fn = node.childForFieldName?.("function");
      let name = null;
      if (fn) {
        if (fn.type === "identifier") name = fn.text;
        else if (fn.type === "attribute") {
          const attr = fn.childForFieldName?.("attribute");
          if (attr) name = attr.text;
        }
      }
      if (name) calls.push({ name, line: lineOf(node) });
    }
    for (let i = node.namedChildCount - 1; i >= 0; i--) stack.push(node.namedChild(i));
  }
  return calls;
};

const PARSE_OPTS = { bufferSize: 8 * 1024 * 1024 };

export function parse(source) {
  const tree = getParser().parse(source, undefined, PARSE_OPTS);
  const root = tree.rootNode;
  return {
    symbols: collectSymbols(root),
    imports: collectImports(root),
    calls: collectCalls(root),
  };
}
