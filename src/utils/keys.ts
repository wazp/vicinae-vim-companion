/**
 * Key-notation helpers: normalizing user-typed key descriptions, splitting a
 * sequence into individual keys, and expanding <leader> for display.
 */

const SPECIAL_NAMES: Record<string, string> = {
  space: "Space",
  spc: "Space",
  cr: "CR",
  enter: "CR",
  return: "CR",
  esc: "Esc",
  escape: "Esc",
  tab: "Tab",
  bs: "BS",
  backspace: "BS",
  leader: "leader",
  localleader: "localleader",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  bar: "Bar",
  bslash: "Bslash",
  lt: "lt",
  nop: "Nop",
  del: "Del",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
};

const MODIFIERS: Record<string, string> = { c: "C", ctrl: "C", control: "C", m: "M", a: "M", alt: "M", meta: "M", s: "S", shift: "S", d: "D", cmd: "D" };

/** Canonicalize a single <...> key, e.g. <c-R> -> <C-r>, <space> -> <Space>, <LEADER> -> <leader>. */
export function canonicalKey(inner: string): string {
  const parts = inner.split("-");
  if (parts.length > 1 && parts[parts.length - 1] === "") {
    // <C--> style: the key itself is "-"
    parts.splice(parts.length - 2, 2, "-");
  }
  const key = parts.pop() ?? "";
  const mods = parts.map((m) => MODIFIERS[m.toLowerCase()] ?? m.toUpperCase());
  let name = SPECIAL_NAMES[key.toLowerCase()] ?? (key.length === 1 ? key : key.replace(/^f(\d+)$/i, "F$1"));
  // Vim treats <C-R> and <C-r> as the same key; normalize to lowercase.
  if (mods.includes("C") && name.length === 1 && !mods.includes("S")) name = name.toLowerCase();
  if (mods.length === 0) {
    if (name.length === 1) return name === "<" ? "<lt>" : name;
    return `<${name}>`;
  }
  return `<${[...new Set(mods)].join("-")}-${name}>`;
}

/** Split a key sequence into keys: `<C-w>v` -> [`<C-w>`, `v`]. */
export function splitKeys(seq: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < seq.length) {
    if (seq[i] === "<") {
      const close = seq.indexOf(">", i + 1);
      const inner = close > i + 1 ? seq.slice(i + 1, close) : "";
      if (close > i + 1 && /^[A-Za-z][\w-]*(-.)?$|^[A-Za-z]+-.$/.test(inner) && !inner.includes(" ")) {
        out.push(canonicalKey(inner));
        i = close + 1;
        continue;
      }
    }
    if (seq[i] === "{") {
      const close = seq.indexOf("}", i + 1);
      if (close > i) {
        out.push(seq.slice(i, close + 1));
        i = close + 1;
        continue;
      }
    }
    out.push(seq[i] === " " ? "<Space>" : seq[i]);
    i++;
  }
  return out;
}

/** Normalize a key sequence so equivalent notations compare equal. */
export function normalizeKeys(seq: string): string {
  return splitKeys(seq)
    .map((k) => (k === "<lt>" ? "<" : k))
    .join("");
}

/**
 * Interpret free-form key descriptions such as "ctrl-r", "ctrl+w v", "^R" or
 * "<c-r>" as Vim notation. Returns undefined when the input does not look like
 * a modifier description, so plain words are left alone.
 */
export function parseKeyQuery(query: string): string | undefined {
  const q = query.trim();
  if (!q) return undefined;
  let changed = false;
  let out = q.replace(/\b(ctrl|control|alt|meta|shift|cmd)\s*[-+]\s*(\S)/gi, (_m, mod: string, key: string) => {
    changed = true;
    return `<${MODIFIERS[mod.toLowerCase()]}-${key}>`;
  });
  out = out.replace(/(^|\s)\^([A-Za-z\[\]\\^])(?=\s|$|[^A-Za-z])/g, (_m, pre: string, key: string) => {
    changed = true;
    return `${pre}<C-${key}>`;
  });
  if (/<[^>]+>/.test(out)) changed = true;
  if (!changed) return undefined;
  // Remaining whitespace separates keys ("ctrl-w v").
  return normalizeKeys(out.replace(/\s+/g, ""));
}

export function leaderLabel(leader: string | undefined): string | undefined {
  if (leader === undefined || leader === "") return undefined;
  if (leader === " ") return "Space";
  if (leader === "\\") return "\\";
  return splitKeys(leader)
    .map((k) => k.replace(/^<(.*)>$/, "$1"))
    .join(" ");
}

/** Replace <leader>/<localleader> with the configured keys (Vim defaults to backslash). */
export function expandLeader(seq: string, leader = "\\", localLeader = "\\"): string {
  return seq.replace(/<(local)?leader>/gi, (_m, local: string | undefined) => (local ? localLeader : leader));
}

/**
 * Human-readable rendering: `<leader>ff` with leader " " -> `Space f f`.
 * Placeholders such as {char} are kept intact.
 */
export function displayKeys(seq: string, leader?: string, localLeader?: string): string {
  const expanded = leader === undefined && localLeader === undefined ? seq : expandLeader(seq, leader ?? "\\", localLeader ?? "\\");
  return splitKeys(expanded)
    .map((k) => {
      if (k === "<Space>") return "Space";
      if (k === "<lt>") return "<";
      if (/^<leader>$/i.test(k)) return "Leader";
      if (/^<localleader>$/i.test(k)) return "LocalLeader";
      const m = /^<C-(.)>$/.exec(k);
      if (m) return `Ctrl-${m[1]}`;
      return k.replace(/^<(.*)>$/, "$1");
    })
    .join(" ");
}

/** Placeholder-aware matcher: `dt{char}` matches `dt,`; `{count}|` matches `80|`. */
export function templateToRegExp(keys: string): RegExp | undefined {
  if (!keys.includes("{")) return undefined;
  const escaped = keys.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  const source = escaped.replace(/\{([^}]+)\}/g, (_m, name: string) => {
    switch (name) {
      case "char":
      case "char1":
      case "char2":
        return ".";
      case "count":
      case "number":
      case "n":
        return "\\d+";
      case "a-z":
        return "[a-z]";
      case "A-Z":
        return "[A-Z]";
      case "register":
        return "[a-zA-Z0-9\"+*_.%:/#=-]";
      case "mark":
        return "[a-zA-Z0-9'`\\[\\]<>.^\"]";
      default:
        return ".+";
    }
  });
  try {
    return new RegExp(`^${source}$`);
  } catch {
    return undefined;
  }
}
