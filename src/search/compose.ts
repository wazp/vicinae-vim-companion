import type { CommandEntry, ComposedPart } from "../types/commands";
import { normalizeText, STOPWORDS } from "./normalize";

/**
 * Rule-based translation of "operator + scope + text object" phrases into
 * Vim's operator grammar, e.g. "change inside parentheses" -> `ci(`.
 *
 * Only combinations in the whitelists below are produced, so the composer
 * can never emit a key sequence Vim would not understand.
 */

type OperatorId = "d" | "c" | "y" | "v" | "gU" | "gu" | "g~" | ">" | "<" | "=" | "gq";
type ObjectId = "w" | "W" | "s" | "p" | '"' | "'" | "`" | "(" | "[" | "{" | "<" | "t";
type Scope = "i" | "a";

interface OperatorInfo {
  verb: string;
  meaning: string;
  phrases: string[];
  objects: ObjectId[];
}

const ALL_OBJECTS: ObjectId[] = ["w", "W", "s", "p", '"', "'", "`", "(", "[", "{", "<", "t"];
const BLOCK_OBJECTS: ObjectId[] = ["p", "(", "[", "{", "t"];

const OPERATORS: Record<OperatorId, OperatorInfo> = {
  d: {
    verb: "Delete",
    meaning: "delete operator: removes the text (and stores it in a register)",
    phrases: ["delete", "remove", "erase", "cut", "kill", "clear", "empty", "wipe"],
    objects: ALL_OBJECTS,
  },
  c: {
    verb: "Change",
    meaning: "change operator: deletes the text and enters Insert mode",
    phrases: ["change", "replace", "rewrite", "retype", "edit", "overwrite"],
    objects: ALL_OBJECTS,
  },
  y: {
    verb: "Yank",
    meaning: "yank operator: copies the text into a register",
    phrases: ["yank", "copy"],
    objects: ALL_OBJECTS,
  },
  v: {
    verb: "Select",
    meaning: "start characterwise Visual mode; the text object then sets the selection",
    phrases: ["select", "visually select", "highlight", "visual select", "mark"],
    objects: ALL_OBJECTS,
  },
  gU: {
    verb: "Uppercase",
    meaning: "make-uppercase operator",
    phrases: ["uppercase", "upcase", "capitalize", "capitalise", "make uppercase", "upper case"],
    objects: ["w", "W", "s", "p", '"', "'", "`", "(", "[", "{", "t"],
  },
  gu: {
    verb: "Lowercase",
    meaning: "make-lowercase operator",
    phrases: ["lowercase", "downcase", "make lowercase", "lower case"],
    objects: ["w", "W", "s", "p", '"', "'", "`", "(", "[", "{", "t"],
  },
  "g~": {
    verb: "Toggle case of",
    meaning: "toggle-case operator",
    phrases: ["toggle case", "swap case", "invert case", "switch case"],
    objects: ["w", "W", "s", "p", '"', "'", "`", "(", "[", "{", "t"],
  },
  ">": {
    verb: "Indent",
    meaning: "shift-right operator: indents every line the text object touches",
    phrases: ["indent", "shift right"],
    objects: BLOCK_OBJECTS,
  },
  "<": {
    verb: "Unindent",
    meaning: "shift-left operator: unindents every line the text object touches",
    phrases: ["unindent", "dedent", "outdent", "shift left"],
    objects: BLOCK_OBJECTS,
  },
  "=": {
    verb: "Re-indent",
    meaning: "filter-through-indent operator: re-indents the lines using the indent rules",
    phrases: ["reindent", "re indent", "auto indent", "autoindent", "fix indent", "fix indentation"],
    objects: BLOCK_OBJECTS,
  },
  gq: {
    verb: "Format",
    meaning: "format operator: rewraps lines to 'textwidth'",
    phrases: ["format", "wrap", "rewrap", "reflow", "hard wrap"],
    objects: ["s", "p"],
  },
};

const SCOPES: Record<Scope, string[]> = {
  i: ["inside", "inner", "in", "within", "between", "contents", "content", "inbetween"],
  a: ["around", "outer", "including", "include", "surrounding", "with", "plus", "and"],
};

interface ObjectInfo {
  name: string;
  inner: string;
  around: string;
  phrases: string[];
  /** Text objects that are defined by a delimiter character use it in the keys. */
}

const OBJECTS: Record<ObjectId, ObjectInfo> = {
  w: {
    name: "word",
    inner: "the word under the cursor, without surrounding whitespace",
    around: "the word under the cursor plus the whitespace after it",
    phrases: ["word", "current word", "this word"],
  },
  W: {
    name: "WORD",
    inner: "the whitespace-delimited WORD under the cursor",
    around: "the WORD under the cursor plus trailing whitespace",
    phrases: ["big word", "bigword", "whitespace word"],
  },
  s: {
    name: "sentence",
    inner: "the current sentence",
    around: "the current sentence plus trailing whitespace",
    phrases: ["sentence"],
  },
  p: {
    name: "paragraph",
    inner: "the current paragraph (block of non-blank lines)",
    around: "the current paragraph plus the following blank line",
    phrases: ["paragraph", "para"],
  },
  '"': {
    name: "double quotes",
    inner: "the text between double quotes on the current line",
    around: "a double-quoted string including the quotes and trailing whitespace",
    phrases: ["double quotes", "double quote", "quotes", "quote", "string", "quoted string", "quotation marks", "dquote"],
  },
  "'": {
    name: "single quotes",
    inner: "the text between single quotes on the current line",
    around: "a single-quoted string including the quotes and trailing whitespace",
    phrases: ["single quotes", "single quote", "apostrophes", "apostrophe", "squote"],
  },
  "`": {
    name: "backticks",
    inner: "the text between backticks on the current line",
    around: "a backtick-quoted string including the backticks",
    phrases: ["backticks", "backtick", "template string", "template literal"],
  },
  "(": {
    name: "parentheses",
    inner: "the contents of the enclosing ( ) block",
    around: "the enclosing ( ) block including the parentheses",
    phrases: ["parentheses", "parenthesis", "parens", "paren", "round brackets", "round bracket", "arguments", "args", "argument list"],
  },
  "[": {
    name: "square brackets",
    inner: "the contents of the enclosing [ ] block",
    around: "the enclosing [ ] block including the brackets",
    phrases: ["square brackets", "square bracket", "square"],
  },
  "{": {
    name: "braces",
    inner: "the contents of the enclosing { } block",
    around: "the enclosing { } block including the braces",
    phrases: ["curly braces", "curly brackets", "curly brace", "braces", "brace", "curlies", "code block", "block", "body", "function body"],
  },
  "<": {
    name: "angle brackets",
    inner: "the contents of the enclosing < > pair",
    around: "the enclosing < > pair including the angle brackets",
    phrases: ["angle brackets", "angle bracket", "chevrons", "generics", "generic"],
  },
  t: {
    name: "tag",
    inner: "the contents of the enclosing HTML/XML element",
    around: "the enclosing HTML/XML element including its tags",
    phrases: ["html tags", "html tag", "xml tag", "tags", "tag", "element", "html element"],
  },
};

/** "brackets" on its own is ambiguous; most people mean parentheses. */
const AMBIGUOUS_BRACKETS: Array<[ObjectId, number]> = [
  ["(", 1],
  ["[", 0.85],
  ["{", 0.8],
];

/** Words that may appear without making the phrase less certain. */
const FILLER = new Set(["current", "this", "the", "text", "everything", "all", "whole", "entire", "stuff", "contents", "of", "cursor", "under", "s"]);

export interface ComposedCandidate {
  entry: CommandEntry;
  confidence: number;
}

interface Match {
  value: string;
  start: number;
  length: number;
}

function findPhrase(tokens: string[], phrases: string[], used: Set<number>): Match | undefined {
  // Longest phrase first so "double quotes" wins over "quotes".
  const sorted = [...phrases].sort((a, b) => b.split(" ").length - a.split(" ").length);
  for (const phrase of sorted) {
    const parts = phrase.split(" ");
    for (let i = 0; i + parts.length <= tokens.length; i++) {
      let ok = true;
      for (let j = 0; j < parts.length; j++) {
        if (used.has(i + j) || tokens[i + j] !== parts[j]) {
          ok = false;
          break;
        }
      }
      if (ok) return { value: phrase, start: i, length: parts.length };
    }
  }
  return undefined;
}

function markUsed(used: Set<number>, m: Match) {
  for (let i = 0; i < m.length; i++) used.add(m.start + i);
}

function depluralize(token: string): string {
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss") && !/(quotes|braces|parentheses|brackets|backticks|tags|chevrons|args|apostrophes|curlies|parens|generics|arguments)$/.test(token)) {
    return token.slice(0, -1);
  }
  return token;
}

/**
 * Parse a query into zero or more composed commands. Returns nothing unless
 * both an operator and a text object are recognized.
 */
export function compose(query: string): ComposedCandidate[] {
  const rawTokens = query.trim().split(/\s+/).filter(Boolean);
  const hasUpperWORD = rawTokens.some((t) => t.replace(/[^A-Za-z]/g, "") === "WORD" || t.replace(/[^A-Za-z]/g, "") === "WORDS");
  const tokens = normalizeText(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .map(depluralize);
  if (tokens.length < 2) return [];
  const used = new Set<number>();

  let op: OperatorId | undefined;
  let opMatch: Match | undefined;
  for (const [id, info] of Object.entries(OPERATORS) as Array<[OperatorId, OperatorInfo]>) {
    const m = findPhrase(tokens, info.phrases, used);
    if (m && (!opMatch || m.length > opMatch.length || (m.length === opMatch.length && m.start < opMatch.start))) {
      op = id;
      opMatch = m;
    }
  }
  if (!op || !opMatch) return [];
  markUsed(used, opMatch);

  let objects: Array<[ObjectId, number]> = [];
  if (hasUpperWORD) {
    const idx = tokens.findIndex((t, i) => !used.has(i) && (t === "word" || t === "words"));
    if (idx >= 0) {
      objects = [["W", 1]];
      used.add(idx);
    }
  }
  if (objects.length === 0) {
    let best: { id: ObjectId; m: Match } | undefined;
    for (const [id, info] of Object.entries(OBJECTS) as Array<[ObjectId, ObjectInfo]>) {
      const m = findPhrase(tokens, info.phrases, used);
      if (m && (!best || m.length > best.m.length)) best = { id, m };
    }
    if (best) {
      objects = [[best.id, 1]];
      markUsed(used, best.m);
    } else {
      const m = findPhrase(tokens, ["brackets", "bracket"], used);
      if (m) {
        objects = AMBIGUOUS_BRACKETS;
        markUsed(used, m);
      }
    }
  }
  if (objects.length === 0) return [];

  let scope: Scope | undefined;
  for (const s of ["i", "a"] as Scope[]) {
    const m = findPhrase(tokens, SCOPES[s], used);
    if (m) {
      scope = s;
      markUsed(used, m);
      break;
    }
  }

  // Unrecognized meaningful words make the parse less certain.
  const leftovers = tokens.filter((t, i) => !used.has(i) && !FILLER.has(t) && !STOPWORDS.has(t));
  let confidence = 1 - 0.2 * leftovers.length;
  if (!scope) confidence -= 0.1;
  if (confidence <= 0.3) return [];

  const out: ComposedCandidate[] = [];
  for (const [obj, objWeight] of objects) {
    if (!OPERATORS[op].objects.includes(obj)) continue;
    const s: Scope = scope ?? "i";
    out.push({ entry: buildEntry(op, s, obj), confidence: confidence * objWeight });
  }
  return out;
}

function buildEntry(op: OperatorId, scope: Scope, obj: ObjectId): CommandEntry {
  const opInfo = OPERATORS[op];
  const objInfo = OBJECTS[obj];
  const textObject = `${scope}${obj}`;
  const keys = `${op}${textObject}`;
  const scopeWord = scope === "i" ? "inside" : "around";
  const objName = obj === "w" || obj === "W" || obj === "s" || obj === "p" || obj === "t" ? (scope === "i" ? `inner ${objInfo.name}` : `a ${objInfo.name}`) : `${scopeWord} ${objInfo.name}`;
  const parts: ComposedPart[] = [
    { keys: op, meaning: opInfo.meaning },
    { keys: textObject, meaning: `${scope === "i" ? "inner" : "around"} text object: ${scope === "i" ? objInfo.inner : objInfo.around}` },
  ];
  const description =
    op === "v"
      ? `Visually select ${scope === "i" ? objInfo.inner : objInfo.around}.`
      : `${opInfo.verb} ${scope === "i" ? objInfo.inner : objInfo.around}.`;
  const notes: string[] = [];
  if (obj === '"' || obj === "'" || obj === "`") notes.push("Quote text objects only look at the current line. If the cursor is before the first quote, Vim uses the first quoted string on the line.");
  if (obj === "(" || obj === "[" || obj === "{" || obj === "<") notes.push(`Works from anywhere inside the pair. ${scope === "i" ? "i" : "a"}${obj === "(" ? ")" : obj === "[" ? "]" : obj === "{" ? "}" : ">"} is an equivalent spelling${obj === "(" ? `, as is ${scope}b` : obj === "{" ? `, as is ${scope}B` : ""}.`);
  if (op === "v") notes.push("Repeating the text object in Visual mode extends the selection to the next enclosing object.");
  return {
    id: `composed:${keys}`,
    title: `${opInfo.verb} ${objName}`,
    description,
    keys,
    modes: ["n"],
    category: "Text Objects",
    source: "vim",
    keywords: [],
    aliases: [],
    examples: [`${keys} = ${parts.map((p) => p.keys).join(" + ")}`],
    notes: notes.length ? notes.join(" ") : undefined,
    status: "reference",
    composed: parts,
  };
}
