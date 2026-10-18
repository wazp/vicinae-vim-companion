import { join } from "node:path";
import {
	type Env,
	exists,
	expandHome,
	findExecutable,
	isExecutable,
	resolveNvimConfig,
	vimrcCandidates,
} from "../utils/paths";
import { runProcess } from "../utils/process";
import type { EditorInfo, EnvironmentInfo, NeovimConfigInfo } from "./types";

export interface DetectionOptions {
	preferredEditor?: "auto" | "vim" | "neovim";
	vimPath?: string;
	nvimPath?: string;
	nvimConfig?: string;
	env?: Env;
	platform?: NodeJS.Platform;
	timeoutMs?: number;
}

/** "NVIM v0.11.5" -> "0.11.5" */
export function parseNeovimVersion(output: string): {
	version?: string;
	line?: string;
} {
	const line = output
		.split("\n")
		.find((l) => /^NVIM v/i.test(l.trim()))
		?.trim();
	return {
		version: line
			? /v(\d+\.\d+\.\d+(?:[-+][\w.-]+)*)/.exec(line)?.[1]
			: undefined,
		line,
	};
}

/** "VIM - Vi IMproved 9.1 (...)" + "Included patches: 1-1234" -> "9.1.1234" */
export function parseVimVersion(output: string): {
	version?: string;
	line?: string;
} {
	const lines = output.split("\n");
	const line = lines.find((l) => /^VIM - Vi IMproved/i.test(l.trim()))?.trim();
	if (!line) return {};
	const base = /IMproved\s+(\d+\.\d+)/.exec(line)?.[1];
	const patches = lines
		.map((l) => /Included patches:\s*(?:\d+-)?(\d+)/.exec(l)?.[1])
		.find(Boolean);
	return {
		version: base ? (patches ? `${base}.${patches}` : base) : undefined,
		line,
	};
}

async function probe(
	kind: "vim" | "neovim",
	path: string,
	foundVia: EditorInfo["foundVia"],
	env: Env,
	timeoutMs: number,
): Promise<EditorInfo> {
	const res = await runProcess(path, ["--version"], {
		env,
		timeoutMs,
		maxBuffer: 256 * 1024,
	});
	if (res.spawnError) return { kind, path, foundVia, error: res.spawnError };
	const parsed =
		kind === "neovim"
			? parseNeovimVersion(res.stdout)
			: parseVimVersion(res.stdout);
	if (!parsed.line) {
		return {
			kind,
			path,
			foundVia,
			error: `${path} --version did not identify as ${kind === "neovim" ? "Neovim" : "Vim"}${res.timedOut ? " (timed out)" : ""}`,
		};
	}
	return {
		kind,
		path,
		foundVia,
		version: parsed.version,
		versionLine: parsed.line,
	};
}

async function locate(
	name: string,
	override: string | undefined,
	env: Env,
	platform: NodeJS.Platform,
): Promise<{
	path?: string;
	foundVia: EditorInfo["foundVia"];
	error?: string;
}> {
	const o = override?.trim();
	if (o) {
		const p = expandHome(o, env);
		if (await isExecutable(p)) return { path: p, foundVia: "preference" };
		return {
			foundVia: "preference",
			error: `Configured executable "${o}" was not found or is not executable`,
		};
	}
	return { path: await findExecutable(name, env, platform), foundVia: "path" };
}

export async function neovimConfigInfo(
	override: string | undefined,
	env: Env,
): Promise<NeovimConfigInfo> {
	const resolved = resolveNvimConfig(override, env);
	const cfgEnv: Record<string, string> = {};
	for (const [k, v] of Object.entries(resolved.env))
		if (v !== undefined) cfgEnv[k] = v;
	return {
		configDir: resolved.configDir,
		appName: resolved.appName,
		env: cfgEnv,
		exists: await exists(resolved.configDir),
		lazyvimJson: await exists(join(resolved.configDir, "lazyvim.json")),
	};
}

/** Detect installed editors and their configuration. Never throws. */
export async function detectEnvironment(
	options: DetectionOptions = {},
): Promise<EnvironmentInfo> {
	const env = options.env ?? process.env;
	const platform = options.platform ?? process.platform;
	const timeoutMs = options.timeoutMs ?? 5000;
	const warnings: string[] = [];
	const info: EnvironmentInfo = { detectedAt: Date.now(), warnings };

	const [nvimLoc, vimLoc] = await Promise.all([
		locate("nvim", options.nvimPath, env, platform),
		locate("vim", options.vimPath, env, platform),
	]);

	const tasks: Array<Promise<void>> = [];
	if (nvimLoc.error) warnings.push(nvimLoc.error);
	if (nvimLoc.path) {
		const nvimPath = nvimLoc.path;
		tasks.push(
			(async () => {
				const editor = await probe(
					"neovim",
					nvimPath,
					nvimLoc.foundVia,
					env,
					timeoutMs,
				);
				if (editor.error) warnings.push(editor.error);
				const config = await neovimConfigInfo(options.nvimConfig, env);
				if (options.nvimConfig?.trim() && !config.exists)
					warnings.push(
						`Neovim configuration "${options.nvimConfig}" does not exist at ${config.configDir}`,
					);
				info.neovim = { ...editor, config };
			})(),
		);
	}
	if (vimLoc.error) warnings.push(vimLoc.error);
	if (vimLoc.path) {
		const vimPath = vimLoc.path;
		tasks.push(
			(async () => {
				const editor = await probe(
					"vim",
					vimPath,
					vimLoc.foundVia,
					env,
					timeoutMs,
				);
				if (editor.error) warnings.push(editor.error);
				let vimrc: string | undefined;
				for (const c of vimrcCandidates(env)) {
					if (await exists(c)) {
						vimrc = c;
						break;
					}
				}
				info.vim = { ...editor, vimrc };
			})(),
		);
	}
	await Promise.all(tasks);

	const usable = (e?: EditorInfo) => e !== undefined && !e.error;
	const pref = options.preferredEditor ?? "auto";
	if (pref === "neovim")
		info.active = usable(info.neovim) ? "neovim" : undefined;
	else if (pref === "vim") info.active = usable(info.vim) ? "vim" : undefined;
	else
		info.active = usable(info.neovim)
			? "neovim"
			: usable(info.vim)
				? "vim"
				: undefined;
	if (pref !== "auto" && !info.active)
		warnings.push(
			`Preferred editor ${pref === "vim" ? "Vim" : "Neovim"} was not found`,
		);
	return info;
}
