import assert from "node:assert/strict";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { detectEnvironment } from "../../src/discovery/environment";
import { discoverNeovim } from "../../src/discovery/neovim";
import type { EditorInfo, EnvironmentInfo } from "../../src/discovery/types";
import { discoverVim } from "../../src/discovery/vim";
import { tempDir } from "../helpers";

/**
 * Real-editor integration tests. They run only when the editor is installed.
 * Config-mode tests additionally require VIM_COMPANION_TEST_USER_CONFIG=1,
 * because they execute the developer's own configuration.
 */
let nvim: EnvironmentInfo["neovim"];
let vim: (EditorInfo & { vimrc?: string }) | undefined;
before(async () => {
	const env = await detectEnvironment();
	nvim = env.neovim && !env.neovim.error ? env.neovim : undefined;
	vim = env.vim && !env.vim.error ? env.vim : undefined;
});
const userConfig = process.env.VIM_COMPANION_TEST_USER_CONFIG === "1";

describe("real Neovim", () => {
	const { dir, cleanup } = tempDir();
	after(cleanup);

	it("discovers built-in default mappings in safe mode", async (t) => {
		if (!nvim) return t.skip("nvim not installed");
		const r = await discoverNeovim(nvim, nvim.config, {
			mode: "safe",
			workDir: join(dir, "w"),
		});
		assert.equal(r.ok, true, r.error ?? "");
		assert.ok(r.entries.length > 10, `${r.entries.length} entries`);
		assert.ok(
			r.entries.every((e) => e.source === "neovim"),
			"safe mode only sees Neovim defaults",
		);
		assert.equal(r.lazyvim?.detected, false);
		assert.ok(r.entries.some((e) => e.keys === "Y"));
	});

	it(
		"discovers the user's configuration",
		{ skip: !userConfig && "set VIM_COMPANION_TEST_USER_CONFIG=1" },
		async (t) => {
			if (!nvim) return t.skip("nvim not installed");
			const r = await discoverNeovim(nvim, nvim.config, {
				mode: "config",
				workDir: join(dir, "w"),
			});
			assert.equal(r.ok, true, r.error ?? "");
			assert.ok(r.entries.length > 0);
			console.log(
				`    nvim ${nvim.version}: ${r.entries.length} mappings, leader=${JSON.stringify(r.leader)}, lazyvim=${r.lazyvim?.detected ? r.lazyvim.version : "no"}, ${r.durationMs}ms`,
			);
		},
	);
});

describe("real Vim", () => {
	const { dir, cleanup } = tempDir();
	after(cleanup);

	it("discovers default mappings in safe mode", async (t) => {
		if (!vim) return t.skip("vim not installed");
		const r = await discoverVim(vim, { mode: "safe", workDir: join(dir, "w") });
		assert.equal(r.ok, true, r.error ?? "");
	});
});
