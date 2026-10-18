import type { DiscoveryMode } from "../discovery/types";

/** Extension preferences after parsing and defaulting. */
export interface Settings {
	preferredEditor: "auto" | "vim" | "neovim";
	runtimeDiscovery: DiscoveryMode;
	vimPath?: string;
	nvimPath?: string;
	nvimConfig?: string;
	includeBuiltins: boolean;
	includeCustom: boolean;
	includePlugins: boolean;
	leaderOverride?: string;
	resultLimit: number;
}

export const DEFAULT_SETTINGS: Settings = {
	preferredEditor: "auto",
	runtimeDiscovery: "config",
	includeBuiltins: true,
	includeCustom: true,
	includePlugins: true,
	resultLimit: 50,
};

const trimmed = (v: unknown) =>
	typeof v === "string" && v.trim() ? v.trim() : undefined;

/** Parse raw preference values defensively; unknown values fall back to defaults. */
export function parseSettings(raw: Record<string, unknown>): Settings {
	const editor = raw.preferredEditor;
	const discovery = raw.runtimeDiscovery;
	const limit = Number(raw.resultLimit);
	const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
	return {
		preferredEditor: editor === "vim" || editor === "neovim" ? editor : "auto",
		runtimeDiscovery:
			discovery === "safe" || discovery === "off" ? discovery : "config",
		vimPath: trimmed(raw.vimPath),
		nvimPath: trimmed(raw.nvimPath),
		nvimConfig: trimmed(raw.nvimAppName),
		includeBuiltins: bool(raw.includeBuiltins, true),
		includeCustom: bool(raw.includeCustom, true),
		includePlugins: bool(raw.includePlugins, true),
		leaderOverride:
			typeof raw.leaderOverride === "string" && raw.leaderOverride !== ""
				? parseLeader(raw.leaderOverride)
				: undefined,
		resultLimit:
			Number.isFinite(limit) && limit > 0 ? Math.min(limit, 500) : 50,
	};
}

/** Accept "Space", "<Space>", "space", "," or "\\" for the leader override. */
export function parseLeader(value: string): string | undefined {
	const v = value.trim();
	if (value === " " || /^<?space>?$/i.test(v)) return " ";
	if (/^<?(bslash|backslash)>?$/i.test(v)) return "\\";
	if (/^<?comma>?$/i.test(v)) return ",";
	return v || undefined;
}
