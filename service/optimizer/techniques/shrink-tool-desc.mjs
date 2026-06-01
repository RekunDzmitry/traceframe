// Compress tool/function descriptions: strip examples, redundant sentences,
// and verbose boilerplate while keeping the signature and core behaviour.

const STRIP_PATTERNS = [
  // "For example, ..." or "Example: ..."
  /\bFor example[,:].*?(?=\n|$)/gi,
  /\bExample[s]?[,:].*?(?=\n|$)/gi,
  // "Note that ..." padding
  /\bNote that\b[^.]*\./gi,
  // "This function/tool ..." restatement of name
  /\bThis (function|tool|method|command)\b[^.]*\./gi,
  // "You can use this to ..."
  /\bYou can use this (to|for)\b[^.]*\./gi,
  // "Returns a/the ..." when it's just boilerplate
  /\bReturns (a|the|an) [a-z]+ (object|value|result|response) containing\b[^.]*\./gi,
];

/**
 * @typedef {{ name: string, description?: string, [key: string]: unknown }} ToolDef
 */

/**
 * Shrink descriptions in an array of tool definitions.
 * @param {ToolDef[]} tools
 * @returns {{ tools: ToolDef[], savedChars: number }}
 */
export function shrinkToolDescs(tools) {
  let savedChars = 0;
  const out = tools.map((tool) => {
    if (!tool.description) return tool;
    let desc = tool.description;
    for (const pattern of STRIP_PATTERNS) {
      desc = desc.replace(pattern, "");
    }
    desc = desc.replace(/  +/g, " ").replace(/\n{2,}/g, "\n").trim();
    savedChars += tool.description.length - desc.length;
    return { ...tool, description: desc };
  });
  return { tools: out, savedChars };
}
