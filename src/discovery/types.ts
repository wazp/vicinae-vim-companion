import type { CommandEntry, EntryStatus } from "../types/commands";

export type DiscoveryMode = "config" | "safe" | "off";

export interface EditorInfo {
	kind: "vim" | "neovim";
	path: string;
	/** e.g. "0.11.5" or "9.1.1234". */
	version?: string;
	versionLine?: string;
	/** Where the executable came from. */
	foundVia: "preference" | "path";
	error?: string;
}

export interface NeovimConfigInfo {
	configDir: string;
	appName: string;
	/** Environment overrides needed to make Neovim use this config. */
	env: Record<string, string>;
	exists: boolean;
	/** lazyvim.json exists in the config dir: a strong static hint, not proof. */
	lazyvimJson: boolean;
}

export interface EnvironmentInfo {
	detectedAt: number;
	vim?: EditorInfo & { vimrc?: string };
	neovim?: EditorInfo & { config: NeovimConfigInfo };
	/** The editor whose mappings are shown, after applying the preference. */
	active?: "vim" | "neovim";
	warnings: string[];
}

export interface DiscoveryReport {
	editor: "vim" | "neovim";
	mode: Exclude<DiscoveryMode, "off">;
	ok: boolean;
	error?: string;
	stderr?: string;
	durationMs: number;
	leader?: string;
	localLeader?: string;
	lazy?: { pluginCount: number; loadedCount: number; disabledCount: number };
	lazyvim?: { detected: boolean; version?: string; extras: string[] };
	/** Non-fatal problems reported by the extraction script. */
	scriptErrors: string[];
	counts: Partial<Record<EntryStatus, number>>;
	limitations: string[];
	entries: CommandEntry[];
}

/** JSON written by NVIM_MAIN_SCRIPT. */
export interface NvimDump {
	version?: string;
	leader?: string;
	localleader?: string;
	config?: string;
	vimruntime?: string;
	appname?: string;
	instrumented?: boolean;
	errors?: string[];
	maps?: NvimMap[];
	lazy?: {
		root?: string;
		plugins?: Array<{
			name: string;
			loaded?: boolean;
			lazy?: boolean;
			dir?: string;
			keys?: NvimLazyKey[];
		}>;
		disabled?: string[];
	};
	lazyvim?: {
		version?: string;
		extras?: string[];
		lsp_keys?: Array<{
			lhs: string;
			modes: string[];
			desc?: string;
			has?: string[];
			server?: string;
		}>;
	};
}

export interface NvimMap {
	mode: string;
	lhs: string;
	/** keytrans() form, e.g. "<Space>ff". */
	norm?: string;
	/** Join key shared with lazy specs and recorded origins (keytrans of the termcode bytes). */
	match?: string;
	rhs?: string;
	desc?: string;
	callback?: boolean;
	expr?: boolean;
	noremap?: boolean;
	buffer?: boolean;
	sid?: number;
	origin?: string;
	via_lazy?: boolean;
}

export interface NvimLazyKey {
	lhs: string;
	match?: string;
	modes: string[];
	desc?: string;
	ft?: string | string[];
	rhs?: string;
}

/** JSON written by VIM_SCRIPT. */
export interface VimDump {
	version?: number;
	leader?: string | null;
	localleader?: string | null;
	myvimrc?: string;
	vimruntime?: string;
	maps?: Array<{
		lhs: string;
		rhs?: string;
		mode: string;
		sid?: number;
		lnum?: number;
		buffer?: number;
		noremap?: number;
	}>;
	scripts?: Array<{ sid: number; name: string }>;
	text?: string;
	errors?: string[];
}
