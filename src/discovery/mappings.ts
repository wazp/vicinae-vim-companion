import type {
	CommandEntry,
	EntryStatus,
	Mode,
	Source,
} from "../types/commands";
import { MODE_LABELS } from "../types/commands";
import { displayKeys, normalizeKeys } from "../utils/keys";

const VALID_MODES = new Set(Object.keys(MODE_LABELS));

/** Expand map-command mode letters (":map" = " ", "v", "!") into single modes. */
export function expandModes(mode: string): Mode[] {
	const out: Mode[] = [];
	for (const ch of mode === "" || mode === " " ? "nxo" : mode) {
		if (ch === " ") out.push("n", "x", "o");
		else if (ch === "v") out.push("x", "s");
		else if (ch === "!") out.push("i", "c");
		else if (VALID_MODES.has(ch)) out.push(ch as Mode);
	}
	return [...new Set(out)];
}

/** Visual + Select is how most "v" maps end up; show them as just Visual. */
export function simplifyModes(modes: Mode[]): Mode[] {
	const set = new Set(modes);
	if (set.has("x") && set.has("s")) set.delete("s");
	const order: Mode[] = ["n", "x", "s", "o", "i", "c", "t", "l", "v"];
	return order.filter((m) => set.has(m));
}

/** Rewrite a real key sequence into <leader>/<localleader> notation when it starts with them. */
export function symbolicKeys(
	norm: string,
	leader?: string,
	localLeader?: string,
): string {
	const candidates: Array<[string | undefined, string]> = [
		[leader, "<leader>"],
		[localLeader, "<localleader>"],
	];
	for (const [key, symbol] of candidates) {
		if (key === undefined || key === "") continue;
		const k = normalizeKeys(key);
		if (norm.startsWith(k) && norm.length > k.length)
			return symbol + norm.slice(k.length);
	}
	return norm;
}

/** Strip noise from desc strings: which-key icons, trailing periods, etc. */
export function cleanDesc(desc: string | undefined): string | undefined {
	if (!desc) return undefined;
	const d = desc.replace(/\s+/g, " ").trim();
	if (!d || d === "which_key_ignore") return undefined;
	return d.charAt(0).toUpperCase() + d.slice(1);
}

/** A readable title when there is no desc. Never interprets Lua callbacks. */
export function titleFromRhs(
	rhs: string | undefined,
	callback: boolean,
): string {
	if (rhs) {
		const plug = /^<Plug>\(?([\w-]+)\)?$/.exec(rhs);
		if (plug) {
			const words = plug[1]
				.replace(/([a-z])([A-Z])/g, "$1 $2")
				.replace(/[-_]/g, " ")
				.toLowerCase();
			return words.charAt(0).toUpperCase() + words.slice(1);
		}
		const cmd = /^(?:<cmd>|<Cmd>|:)\s*(.+?)\s*(?:<cr>|<CR>|<Enter>)?$/i.exec(
			rhs,
		);
		if (cmd) return `:${cmd[1]}`;
		return rhs.length > 60 ? `${rhs.slice(0, 57)}...` : rhs;
	}
	return callback
		? "Lua function (no description)"
		: "Mapping (no description)";
}

const NOISE = /^(lua|cmd|cr|the|a|an|to|of|and|or|in|on|for)$/i;

function searchWords(text: string): string[] {
	return text
		.split(/[^\p{L}\p{N}]+/u)
		.filter((w) => w.length > 1 && !NOISE.test(w));
}

export interface RuntimeMappingInput {
	editor: "vim" | "neovim";
	norm: string;
	modes: Mode[];
	desc?: string;
	rhs?: string;
	callback?: boolean;
	status: EntryStatus;
	source: Source;
	sourceName?: string;
	context?: string;
	leader?: string;
	localLeader?: string;
	notes?: string;
	idSuffix?: string;
}

export function buildRuntimeEntry(input: RuntimeMappingInput): CommandEntry {
	const keys = symbolicKeys(input.norm, input.leader, input.localLeader);
	// Neovim's own defaults carry "desc" values like ":help Y-default".
	const helpRef = /^:help (\S+)$/.exec(input.desc ?? "")?.[1];
	const desc = helpRef ? undefined : cleanDesc(input.desc);
	const title =
		desc ??
		(helpRef && input.rhs
			? `Default: ${titleFromRhs(input.rhs, false)}`
			: titleFromRhs(input.rhs, input.callback ?? false));
	const rhs = input.rhs ?? (input.callback ? "<Lua callback>" : undefined);
	const description = desc
		? `${desc}${/[.!?]$/.test(desc) ? "" : "."}${input.rhs ? ` Runs ${input.rhs}.` : ""}`
		: input.rhs
			? `Runs ${input.rhs}.`
			: "Runs a Lua function. No description was provided, so its behavior is not shown here.";
	const display = displayKeys(input.norm);
	const modes = simplifyModes(input.modes);
	const words = [
		...searchWords(desc ?? ""),
		...searchWords(input.sourceName ?? ""),
		...(input.rhs ? searchWords(input.rhs) : []),
	];
	return {
		id: `${input.editor}:${input.status}:${modes.join("")}:${input.norm}${input.idSuffix ? `:${input.idSuffix}` : ""}`,
		title,
		description,
		keys,
		keysExpanded: input.norm,
		keysDisplay: keys !== input.norm ? display : undefined,
		modes,
		category: "Keymaps",
		source: input.source,
		sourceName: input.sourceName,
		keywords: [...new Set(words.map((w) => w.toLowerCase()))],
		aliases: desc
			? [...new Set([desc, desc.replace(/\s*\([^)]*\)/g, "").trim()])].filter(
					Boolean,
				)
			: [],
		status: input.status,
		context: input.context,
		rhs,
		editor: input.editor,
		notes: helpRef
			? [input.notes, `See :help ${helpRef}.`].filter(Boolean).join(" ")
			: input.notes,
	};
}

/** Count entries per status for diagnostics. */
export function countByStatus(
	entries: CommandEntry[],
): Partial<Record<EntryStatus, number>> {
	const counts: Partial<Record<EntryStatus, number>> = {};
	for (const e of entries) counts[e.status] = (counts[e.status] ?? 0) + 1;
	return counts;
}
