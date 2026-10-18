import type { Category, CommandEntry, Mode, Source } from "../../types/commands";

export interface RefSpec {
  keys: string;
  title: string;
  desc: string;
  modes?: Mode[];
  /** Single-word search terms. */
  kw?: string[];
  /** Plain-English phrasings of the intent, e.g. "replace word". */
  aliases?: string[];
  ex?: string[];
  notes?: string;
  /** Override for the default `vim` source (e.g. Neovim-only defaults). */
  source?: Source;
  requires?: string;
  id?: string;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export function section(category: Category, defaultModes: Mode[], specs: RefSpec[]): CommandEntry[] {
  return specs.map((s) => {
    const modes = s.modes ?? defaultModes;
    const source = s.source ?? "vim";
    return {
      id: s.id ?? `ref:${slug(category)}:${s.keys}:${modes.join("")}`,
      title: s.title,
      description: s.desc,
      keys: s.keys,
      modes,
      category,
      source,
      keywords: s.kw ?? [],
      aliases: s.aliases ?? [],
      examples: s.ex,
      notes: s.notes,
      status: "reference",
      availabilityReason: s.requires,
    };
  });
}

/** Motions work in Normal, Visual and Operator-pending mode. */
export const MOTION_MODES: Mode[] = ["n", "x", "o"];
/** Text objects only make sense after an operator or in Visual mode. */
export const TEXT_OBJECT_MODES: Mode[] = ["o", "x"];
