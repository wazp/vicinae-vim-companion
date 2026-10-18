import { chmod, mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

/**
 * Tools that plugin managers and installers (lazy.nvim, vim-plug, mason,
 * nvim-treesitter, vim.pack) use to download or build things. During discovery
 * they are shadowed by stubs that exit with an error, so loading a config can
 * not install or update plugins. This is a guard rail, not a security sandbox.
 */
export const STUBBED_TOOLS = [
	"git",
	"curl",
	"wget",
	"tar",
	"unzip",
	"gzip",
	"cc",
	"gcc",
	"clang",
	"make",
	"cmake",
	"tree-sitter",
	"npm",
	"npx",
	"yarn",
	"pnpm",
	"pip",
	"pip3",
	"cargo",
	"go",
];

export interface Sandbox {
	stubDir?: string;
	/** PATH with the stub directory prepended. */
	path(original: string | undefined): string;
}

export async function prepareSandbox(
	workDir: string,
	platform: NodeJS.Platform = process.platform,
): Promise<Sandbox> {
	if (platform === "win32") return { path: (p) => p ?? "" };
	const stubDir = join(workDir, "stubs");
	await mkdir(stubDir, { recursive: true });
	const script =
		"#!/bin/sh\necho 'vim-companion: network and build tools are disabled during keymap discovery' >&2\nexit 1\n";
	await Promise.all(
		STUBBED_TOOLS.map(async (tool) => {
			const p = join(stubDir, tool);
			await writeFile(p, script);
			await chmod(p, 0o755);
		}),
	);
	return { stubDir, path: (p) => (p ? `${stubDir}${delimiter}${p}` : stubDir) };
}
