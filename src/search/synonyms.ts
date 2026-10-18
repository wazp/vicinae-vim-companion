import { stem } from "./normalize";

/**
 * True synonyms: every word in a group is rewritten to the group's first word,
 * on both the index side and the query side. Only words that mean the same
 * thing in Vim terms belong here.
 */
const EQUIVALENT: string[][] = [
  ["yank", "copy", "copying"],
  ["delete", "remove", "erase", "kill", "cut", "del", "rm"],
  ["change", "replace", "rewrite", "retype"],
  ["search", "find", "look", "locate", "grep", "seek"],
  ["directory", "folder", "dir"],
  ["start", "beginning", "begin", "head", "home", "first"],
  ["previous", "prev", "back", "backward", "backwards", "earlier", "older"],
  ["next", "forward", "forwards", "following"],
  ["go", "goto", "jump", "navigate", "travel"],
  ["paren", "parentheses", "parenthesis", "parens", "round"],
  ["brace", "braces", "curly", "curlies"],
  ["quote", "quotes", "quotation", "quoted"],
  ["single", "apostrophe"],
  ["paste", "put"],
  ["save", "write", "store"],
  ["quit", "exit", "leave"],
  ["uppercase", "upper", "capitalize", "capitalise", "caps", "capital"],
  ["lowercase", "lower"],
  ["unindent", "dedent", "outdent"],
  ["character", "char", "letter", "chars"],
  ["paragraph", "para"],
  ["definition", "def", "define", "defined"],
  ["reference", "usage", "usages", "callers"],
  ["function", "func", "fn", "method"],
  ["diagnostic", "error", "warning", "problem", "lint", "diagnostics"],
  ["project", "workspace", "codebase", "repo", "repository"],
  ["macro", "recording"],
  ["clipboard", "pasteboard"],
  ["line", "row", "lines"],
  ["select", "selection", "visual"],
  ["undo", "revert"],
  ["file", "files", "document"],
  ["window", "pane", "split", "splits"],
  ["comment", "uncomment"],
  ["explorer", "tree", "sidebar", "browser"],
  ["mapping", "keymap", "keybinding", "binding", "bind", "map"],
  ["terminal", "shell", "console", "term"],
  ["highlight", "hlsearch"],
];

/**
 * Related, but not identical, concepts: a match through these counts for less
 * than a direct match. Kept one-directional where the meanings are asymmetric
 * (people say "brackets" for parentheses, never the reverse).
 */
const RELATED: Array<[string, string, number]> = [
  ["bracket", "paren", 0.85],
  ["bracket", "brace", 0.7],
  ["bracket", "square", 0.6],
  ["block", "brace", 0.6],
  ["block", "paragraph", 0.5],
  ["argument", "paren", 0.8],
  ["args", "paren", 0.8],
  ["string", "quote", 0.8],
  ["double", "quote", 0.4],
  ["end", "bottom", 0.7],
  ["bottom", "end", 0.7],
  ["top", "start", 0.7],
  ["start", "top", 0.6],
  ["move", "go", 0.8],
  ["go", "move", 0.6],
  ["edit", "change", 0.7],
  ["modify", "change", 0.8],
  ["swap", "change", 0.4],
  ["substitute", "change", 0.9],
  ["highlight", "select", 0.6],
  ["mark", "select", 0.3],
  ["tab", "buffer", 0.35],
  ["buffer", "tab", 0.3],
  ["buffer", "file", 0.5],
  ["file", "buffer", 0.4],
  ["window", "tab", 0.3],
  ["duplicate", "yank", 0.6],
  ["clone", "duplicate", 0.9],
  ["rename", "refactor", 0.6],
  ["refactor", "rename", 0.6],
  ["open", "edit", 0.5],
  ["show", "list", 0.6],
  ["list", "show", 0.6],
  ["display", "show", 0.9],
  ["close", "quit", 0.6],
  ["quit", "close", 0.6],
  ["clear", "delete", 0.6],
  ["empty", "delete", 0.5],
  ["redo", "repeat", 0.3],
  ["again", "repeat", 0.8],
  ["last", "previous", 0.5],
  ["recent", "last", 0.8],
  ["inner", "inside", 1],
  ["within", "inside", 0.9],
  ["between", "inside", 0.9],
  ["contents", "inside", 0.7],
  ["outer", "around", 0.9],
  ["including", "around", 0.8],
  ["surrounding", "around", 0.8],
  ["whole", "around", 0.4],
  ["whole", "all", 0.6],
  ["entire", "all", 0.8],
  ["everything", "all", 0.8],
  ["all", "everything", 0.8],
  ["current", "cursor", 0.5],
  ["word", "symbol", 0.3],
  ["symbol", "word", 0.4],
  ["variable", "symbol", 0.7],
  ["declaration", "definition", 0.7],
  ["implementation", "definition", 0.4],
  ["indentation", "indent", 1],
  ["shift", "indent", 0.6],
  ["picker", "search", 0.4],
  ["fuzzy", "search", 0.5],
  ["grep", "project", 0.3],
  ["format", "indent", 0.4],
  ["toggle", "switch", 0.5],
  ["switch", "toggle", 0.4],
  ["switch", "go", 0.5],
  ["create", "new", 0.7],
  ["new", "create", 0.7],
  ["add", "insert", 0.6],
  ["insert", "add", 0.5],
  ["type", "insert", 0.5],
  ["append", "insert", 0.5],
  ["collapse", "fold", 0.8],
  ["expand", "unfold", 0.6],
  ["unfold", "fold", 0.7],
  ["bookmark", "mark", 0.9],
  ["git", "hunk", 0.4],
  ["hunk", "git", 0.6],
  ["completion", "complete", 1],
  ["autocomplete", "complete", 0.9],
  ["case", "uppercase", 0.4],
  ["case", "lowercase", 0.4],
  ["matching", "match", 1],
  ["pair", "match", 0.6],
  ["exact", "whole", 0.4],
  ["scroll", "page", 0.4],
];

const canonicalMap = new Map<string, string>();
for (const group of EQUIVALENT) {
  const target = stem(group[0]);
  for (const word of group) canonicalMap.set(stem(word), target);
}

const relatedMap = new Map<string, Array<{ term: string; weight: number }>>();
for (const [from, to, weight] of RELATED) {
  const f = canonical(stem(from));
  const t = canonical(stem(to));
  if (f === t) continue;
  const list = relatedMap.get(f) ?? [];
  list.push({ term: t, weight });
  relatedMap.set(f, list);
}

/** Map a stemmed term to its canonical synonym (or itself). */
export function canonical(stemmed: string): string {
  return canonicalMap.get(stemmed) ?? stemmed;
}

/** Weighted related concepts for a canonical term. */
export function related(term: string): Array<{ term: string; weight: number }> {
  return relatedMap.get(term) ?? [];
}

/** Every word the synonym tables know about, stemmed. Used as fuzzy-correction vocabulary. */
export function synonymVocabulary(): string[] {
  const words = new Set<string>();
  for (const group of EQUIVALENT) for (const w of group) words.add(stem(w));
  for (const [from, to] of RELATED) {
    words.add(stem(from));
    words.add(stem(to));
  }
  return [...words];
}
