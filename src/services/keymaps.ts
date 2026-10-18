import { join } from "node:path";
import { detectEnvironment, neovimConfigInfo } from "../discovery/environment";
import { discoverNeovim } from "../discovery/neovim";
import type { DiscoveryReport, EnvironmentInfo } from "../discovery/types";
import { discoverVim } from "../discovery/vim";
import type { Settings } from "../types/settings";
import {
	exists,
	expandHome,
	findExecutable,
	homeDir,
	vimrcCandidates,
} from "../utils/paths";
import {
	type CacheData,
	clearCache,
	computeFingerprint,
	readCache,
	writeCache,
} from "./cache";

export interface KeymapState {
	environment: EnvironmentInfo;
	reports: DiscoveryReport[];
	savedAt: number;
	fingerprint: string;
}

export interface ServiceOptions {
	/** Extension-owned directory for the cache and discovery scratch files. */
	supportDir: string;
	settings: Settings;
	env?: NodeJS.ProcessEnv;
	/** Override for tests. */
	timeoutMs?: number;
}

function discoverySettings(s: Settings) {
	return {
		preferredEditor: s.preferredEditor,
		runtimeDiscovery: s.runtimeDiscovery,
		vimPath: s.vimPath,
		nvimPath: s.nvimPath,
		nvimConfig: s.nvimConfig,
	};
}

/** Fingerprint of everything that should invalidate cached mappings. Uses stat only. */
export async function currentFingerprint(
	options: ServiceOptions,
): Promise<string> {
	const env = options.env ?? process.env;
	const s = options.settings;
	const resolve = async (override: string | undefined, name: string) =>
		override ? expandHome(override, env) : await findExecutable(name, env);
	const [nvim, vim] = await Promise.all([
		resolve(s.nvimPath, "nvim"),
		resolve(s.vimPath, "vim"),
	]);
	const nvimCfg = await neovimConfigInfo(s.nvimConfig, env);
	const vimrcs = [];
	for (const c of vimrcCandidates(env)) if (await exists(c)) vimrcs.push(c);
	return computeFingerprint({
		settings: discoverySettings(s),
		executables: [nvim, vim],
		configPaths: [nvimCfg.configDir, ...vimrcs, join(homeDir(env), ".vim")],
	});
}

export interface CachedState {
	state: KeymapState;
	stale: boolean;
}

/** Load cached mappings, and report whether the configuration changed since. */
export async function loadCachedKeymaps(
	options: ServiceOptions,
): Promise<CachedState | undefined> {
	const cache = await readCache(options.supportDir);
	if (!cache) return undefined;
	const fingerprint = await currentFingerprint(options).catch(() => "");
	return { state: fromCache(cache), stale: fingerprint !== cache.fingerprint };
}

function fromCache(c: CacheData): KeymapState {
	return {
		environment: c.environment,
		reports: c.reports,
		savedAt: c.savedAt,
		fingerprint: c.fingerprint,
	};
}

/**
 * Detect editors and run runtime discovery for each relevant one, then cache
 * the result. Never throws; failures are reported per editor.
 */
export async function refreshKeymaps(
	options: ServiceOptions,
): Promise<KeymapState> {
	const s = options.settings;
	const env = options.env ?? process.env;
	const fingerprint = await currentFingerprint(options).catch(() => "");
	const environment = await detectEnvironment({
		preferredEditor: s.preferredEditor,
		vimPath: s.vimPath,
		nvimPath: s.nvimPath,
		nvimConfig: s.nvimConfig,
		env,
	});
	const reports: DiscoveryReport[] = [];
	if (s.runtimeDiscovery !== "off") {
		const workDir = join(options.supportDir, "discovery");
		const mode = s.runtimeDiscovery;
		const wantNvim = s.preferredEditor !== "vim";
		const wantVim = s.preferredEditor !== "neovim";
		const jobs: Array<Promise<DiscoveryReport>> = [];
		if (wantNvim && environment.neovim && !environment.neovim.error) {
			jobs.push(
				discoverNeovim(environment.neovim, environment.neovim.config, {
					mode,
					workDir,
					timeoutMs: options.timeoutMs,
					baseEnv: env,
				}),
			);
		}
		if (wantVim && environment.vim && !environment.vim.error) {
			jobs.push(
				discoverVim(environment.vim, {
					mode,
					workDir,
					vimrc: environment.vim.vimrc,
					timeoutMs: options.timeoutMs,
					baseEnv: env,
				}),
			);
		}
		reports.push(...(await Promise.all(jobs)));
	}
	const state: KeymapState = {
		environment,
		reports,
		savedAt: Date.now(),
		fingerprint,
	};
	try {
		await writeCache(options.supportDir, state);
	} catch (e) {
		environment.warnings.push(
			`Could not write cache: ${e instanceof Error ? e.message : String(e)}`,
		);
	}
	return state;
}

export async function resetKeymapCache(options: ServiceOptions): Promise<void> {
	await clearCache(options.supportDir);
}

/** One-line outcome for toasts. */
export function summarize(state: KeymapState): {
	title: string;
	message?: string;
	ok: boolean;
} {
	const ok = state.reports.filter((r) => r.ok);
	const failed = state.reports.filter((r) => !r.ok);
	const count = ok.reduce((n, r) => n + r.entries.length, 0);
	if (state.reports.length === 0)
		return {
			ok: true,
			title: "Editors detected",
			message: "Runtime discovery is off or no editor was found",
		};
	if (failed.length && !ok.length)
		return {
			ok: false,
			title: "Keymap discovery failed",
			message: failed[0].error,
		};
	return {
		ok: failed.length === 0,
		title: `Found ${count} mappings`,
		message: [
			ok
				.map((r) =>
					r.editor === "neovim"
						? r.lazyvim?.detected
							? "Neovim + LazyVim"
							: "Neovim"
						: "Vim",
				)
				.join(", "),
			failed.length ? `${failed.map((r) => r.editor).join(", ")} failed` : "",
		]
			.filter(Boolean)
			.join(" · "),
	};
}
