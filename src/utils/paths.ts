import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";

export type Env = NodeJS.ProcessEnv;

export function homeDir(env: Env = process.env): string {
	return env.HOME || homedir();
}

export function xdgConfigHome(env: Env = process.env): string {
	return env.XDG_CONFIG_HOME && isAbsolute(env.XDG_CONFIG_HOME)
		? env.XDG_CONFIG_HOME
		: join(homeDir(env), ".config");
}

export function expandHome(p: string, env: Env = process.env): string {
	return p === "~"
		? homeDir(env)
		: p.startsWith("~/")
			? join(homeDir(env), p.slice(2))
			: p;
}

/**
 * Resolve the Neovim configuration to inspect. `override` may be an
 * NVIM_APPNAME profile name (e.g. "lazyvim") or an absolute directory.
 * Returns the config dir plus the environment needed to make Neovim use it.
 */
export function resolveNvimConfig(
	override: string | undefined,
	env: Env = process.env,
): { configDir: string; appName: string; env: Env } {
	const o = override?.trim() ? expandHome(override.trim(), env) : "";
	if (o && isAbsolute(o)) {
		// stdpath("config") is $XDG_CONFIG_HOME/$NVIM_APPNAME, so point both at the directory.
		return {
			configDir: o,
			appName: basename(o),
			env: { XDG_CONFIG_HOME: dirname(o), NVIM_APPNAME: basename(o) },
		};
	}
	const appName = o || env.NVIM_APPNAME || "nvim";
	return {
		configDir: join(xdgConfigHome(env), appName),
		appName,
		env: o ? { NVIM_APPNAME: appName } : {},
	};
}

/** Vim's personal vimrc locations, in Vim's own lookup order. */
export function vimrcCandidates(env: Env = process.env): string[] {
	const home = homeDir(env);
	return [
		join(home, ".vimrc"),
		join(home, ".vim", "vimrc"),
		join(xdgConfigHome(env), "vim", "vimrc"),
	];
}

export async function isExecutable(p: string): Promise<boolean> {
	try {
		const s = await stat(p);
		if (!s.isFile()) return false;
		await access(p, fsConstants.X_OK);
		return true;
	} catch {
		return false;
	}
}

export async function exists(p: string): Promise<boolean> {
	try {
		await stat(p);
		return true;
	} catch {
		return false;
	}
}

/**
 * Directories searched in addition to PATH. Launchers started from a desktop
 * session often have a minimal PATH that misses these.
 */
export function extraBinDirs(
	env: Env = process.env,
	platform: NodeJS.Platform = process.platform,
): string[] {
	const home = homeDir(env);
	const dirs = [
		join(home, ".local", "bin"),
		join(home, "bin"),
		"/usr/local/bin",
		join(home, ".nix-profile", "bin"),
		"/run/current-system/sw/bin",
		"/snap/bin",
		join(home, ".local", "share", "bob", "nvim-bin"),
	];
	if (platform === "darwin") dirs.unshift("/opt/homebrew/bin");
	return dirs;
}

/** Find an executable by name on PATH (plus common extra directories), without spawning a shell. */
export async function findExecutable(
	name: string,
	env: Env = process.env,
	platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
	const pathDirs = (env.PATH ?? "").split(delimiter).filter(Boolean);
	const exts =
		platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];
	const seen = new Set<string>();
	for (const dir of [...pathDirs, ...extraBinDirs(env, platform)]) {
		if (seen.has(dir)) continue;
		seen.add(dir);
		for (const ext of exts) {
			const candidate = join(dir, name + ext);
			if (await isExecutable(candidate)) return candidate;
		}
	}
	return undefined;
}
