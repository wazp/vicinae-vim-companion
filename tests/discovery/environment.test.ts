import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
	detectEnvironment,
	parseNeovimVersion,
	parseVimVersion,
} from "../../src/discovery/environment";
import { findExecutable, resolveNvimConfig } from "../../src/utils/paths";
import { fakeExecutable, tempDir } from "../helpers";

const skipOnWindows = process.platform === "win32";

describe("version parsing", () => {
	it("parses Neovim versions", () => {
		assert.equal(
			parseNeovimVersion("NVIM v0.11.5\nBuild type: Release\n").version,
			"0.11.5",
		);
		assert.equal(
			parseNeovimVersion("NVIM v0.12.0-dev-1234+gabc\n").version,
			"0.12.0-dev-1234+gabc",
		);
		assert.equal(parseNeovimVersion("something else").version, undefined);
	});

	it("parses Vim versions with patch level", () => {
		const out =
			"VIM - Vi IMproved 9.1 (2024 Jan 02, compiled Oct 01 2024)\nIncluded patches: 1-1234\n";
		assert.equal(parseVimVersion(out).version, "9.1.1234");
		assert.equal(parseVimVersion("VIM - Vi IMproved 8.2\n").version, "8.2");
		assert.equal(parseVimVersion("NVIM v0.11.5").version, undefined);
	});
});

describe("paths", () => {
	it("respects XDG_CONFIG_HOME and NVIM_APPNAME", () => {
		const env = {
			HOME: "/home/u",
			XDG_CONFIG_HOME: "/cfg",
			NVIM_APPNAME: "lazyvim",
		};
		assert.equal(resolveNvimConfig(undefined, env).configDir, "/cfg/lazyvim");
		assert.equal(
			resolveNvimConfig(undefined, { HOME: "/home/u" }).configDir,
			"/home/u/.config/nvim",
		);
	});

	it("accepts a profile name or an absolute directory as override", () => {
		const env = { HOME: "/home/u" };
		const profile = resolveNvimConfig("astro", env);
		assert.equal(profile.configDir, "/home/u/.config/astro");
		assert.deepEqual(profile.env, { NVIM_APPNAME: "astro" });
		const abs = resolveNvimConfig("/opt/dots/nvim-work", env);
		assert.equal(abs.configDir, "/opt/dots/nvim-work");
		assert.deepEqual(abs.env, {
			XDG_CONFIG_HOME: "/opt/dots",
			NVIM_APPNAME: "nvim-work",
		});
		assert.equal(resolveNvimConfig("~/x", env).configDir, "/home/u/x");
	});
});

describe("environment detection", { skip: skipOnWindows }, () => {
	const { dir, cleanup } = tempDir();
	after(cleanup);
	const bin = join(dir, "bin");
	const home = join(dir, "home");
	mkdirSync(bin, { recursive: true });
	mkdirSync(join(home, ".config", "nvim"), { recursive: true });
	writeFileSync(
		join(home, ".config", "nvim", "lazyvim.json"),
		JSON.stringify({ extras: ["lazyvim.plugins.extras.lang.go"] }),
	);
	writeFileSync(join(home, ".vimrc"), '" vimrc\n');
	fakeExecutable(bin, "nvim", 'echo "NVIM v0.11.5"');
	fakeExecutable(
		bin,
		"vim",
		'printf "VIM - Vi IMproved 9.1 (2024)\\nIncluded patches: 1-500\\n"',
	);
	const env = { HOME: home, PATH: bin };

	it("finds executables on PATH without a shell", async () => {
		assert.equal(await findExecutable("nvim", env), join(bin, "nvim"));
		assert.equal(await findExecutable("definitely-not-here", env), undefined);
	});

	it("detects both editors, versions and config", async () => {
		const info = await detectEnvironment({ env });
		assert.equal(info.neovim?.version, "0.11.5");
		assert.equal(info.neovim?.config.configDir, join(home, ".config", "nvim"));
		assert.equal(info.neovim?.config.lazyvimJson, true);
		assert.equal(info.vim?.version, "9.1.500");
		assert.equal(info.vim?.vimrc, join(home, ".vimrc"));
		assert.equal(info.active, "neovim", "auto prefers Neovim");
		assert.deepEqual(info.warnings, []);
	});

	it("honors the preferred editor", async () => {
		assert.equal(
			(await detectEnvironment({ env, preferredEditor: "vim" })).active,
			"vim",
		);
	});

	it("uses an explicit executable path from preferences", async () => {
		const custom = fakeExecutable(dir, "my-nvim", 'echo "NVIM v0.9.0"');
		const info = await detectEnvironment({ env, nvimPath: custom });
		assert.equal(info.neovim?.foundVia, "preference");
		assert.equal(info.neovim?.version, "0.9.0");
	});

	it("reports a missing configured executable instead of guessing", async () => {
		const info = await detectEnvironment({
			env,
			nvimPath: "/nope/nvim",
			preferredEditor: "neovim",
		});
		assert.equal(info.neovim, undefined);
		assert.equal(info.active, undefined);
		assert.ok(info.warnings.some((w) => /not found/.test(w)));
	});

	it("does not claim an executable that is not Neovim", async () => {
		const impostor = fakeExecutable(dir, "fake-nvim", 'echo "hello"');
		const info = await detectEnvironment({
			env,
			nvimPath: impostor,
			preferredEditor: "neovim",
		});
		assert.ok(info.neovim?.error);
		assert.equal(info.active, undefined);
	});

	it("works when no editor is installed", async () => {
		const info = await detectEnvironment({
			env: { HOME: home, PATH: join(dir, "empty") },
		});
		// extra bin dirs could contain a real editor on the test machine; only assert it does not throw
		assert.ok(Array.isArray(info.warnings));
	});
});
