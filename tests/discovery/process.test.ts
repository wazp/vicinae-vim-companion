import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { discoverNeovim } from "../../src/discovery/neovim";
import { STUBBED_TOOLS } from "../../src/discovery/sandbox";
import type { NeovimConfigInfo } from "../../src/discovery/types";
import { discoverVim } from "../../src/discovery/vim";
import { excerpt, runProcess } from "../../src/utils/process";
import { fakeExecutable, tempDir } from "../helpers";

const skip = process.platform === "win32";
const fixture = join(__dirname, "..", "fixtures", "nvim-lazyvim.json");
const config: NeovimConfigInfo = {
	configDir: "/home/user/.config/nvim",
	appName: "nvim",
	env: {},
	exists: true,
	lazyvimJson: true,
};

describe("subprocess runner", { skip }, () => {
	const { dir, cleanup } = tempDir();
	after(cleanup);

	it("captures stdout, stderr and exit code", async () => {
		const exe = fakeExecutable(dir, "echoer", "echo out; echo err >&2; exit 3");
		const r = await runProcess(exe, []);
		assert.equal(r.code, 3);
		assert.equal(r.stdout.trim(), "out");
		assert.equal(r.stderr.trim(), "err");
		assert.equal(r.timedOut, false);
	});

	it("passes arguments verbatim, without shell interpretation", async () => {
		const exe = fakeExecutable(dir, "args", 'printf "%s\\n" "$@"');
		const r = await runProcess(exe, ["$(touch pwned)", "a b", ";ls"]);
		assert.deepEqual(r.stdout.trim().split("\n"), [
			"$(touch pwned)",
			"a b",
			";ls",
		]);
	});

	it("kills processes that exceed the timeout", async () => {
		const exe = fakeExecutable(dir, "slow", "sleep 5");
		const started = Date.now();
		const r = await runProcess(exe, [], { timeoutMs: 200 });
		assert.equal(r.timedOut, true);
		assert.ok(Date.now() - started < 3000);
	});

	it("reports missing executables without throwing", async () => {
		const r = await runProcess(join(dir, "missing"), []);
		assert.match(r.spawnError ?? "", /ENOENT/);
	});

	it("truncates noisy output for diagnostics", () => {
		assert.equal(excerpt("x".repeat(5000), 100).length, 103);
	});
});

describe("Neovim discovery pipeline (fake editor)", { skip }, () => {
	const { dir, cleanup } = tempDir();
	after(cleanup);
	const work = join(dir, "work");

	it("reads the dump the editor writes and parses it", async () => {
		const nvim = fakeExecutable(
			dir,
			"nvim-ok",
			`cp "${fixture}" "$VIM_COMPANION_OUT"`,
		);
		const r = await discoverNeovim(
			{ kind: "neovim", path: nvim, foundVia: "path" },
			config,
			{ mode: "config", workDir: work },
		);
		assert.equal(r.ok, true, r.error ?? "");
		assert.equal(r.lazyvim?.detected, true);
		assert.ok(r.entries.length > 10);
	});

	it("shadows network and build tools while the editor runs", async () => {
		const nvim = fakeExecutable(
			dir,
			"nvim-git",
			`if git --version >/dev/null 2>&1; then echo '{"errors":["git ran"]}' > "$VIM_COMPANION_OUT"; else echo '{"errors":["git blocked"]}' > "$VIM_COMPANION_OUT"; fi`,
		);
		const r = await discoverNeovim(
			{ kind: "neovim", path: nvim, foundVia: "path" },
			config,
			{ mode: "config", workDir: work },
		);
		assert.deepEqual(r.scriptErrors, ["git blocked"]);
		assert.ok(STUBBED_TOOLS.includes("curl"));
	});

	it("passes config overrides through the environment", async () => {
		const nvim = fakeExecutable(
			dir,
			"nvim-env",
			`echo "{\\"appname\\":\\"$NVIM_APPNAME\\"}" > "$VIM_COMPANION_OUT"`,
		);
		const r = await discoverNeovim(
			{ kind: "neovim", path: nvim, foundVia: "path" },
			{ ...config, env: { NVIM_APPNAME: "work" } },
			{ mode: "config", workDir: work },
		);
		assert.equal(r.ok, true);
	});

	it("uses --clean in safe mode and loads the user config otherwise", async () => {
		const out = join(dir, "args.txt");
		const nvim = fakeExecutable(
			dir,
			"nvim-args",
			`printf "%s\\n" "$@" > "${out}"; echo '{}' > "$VIM_COMPANION_OUT"`,
		);
		await discoverNeovim(
			{ kind: "neovim", path: nvim, foundVia: "path" },
			config,
			{ mode: "safe", workDir: work },
		);
		const safeArgs = readFileSync(out, "utf8");
		assert.match(safeArgs, /--clean/);
		assert.match(safeArgs, /-i\nNONE/);
		await discoverNeovim(
			{ kind: "neovim", path: nvim, foundVia: "path" },
			config,
			{ mode: "config", workDir: work },
		);
		const cfgArgs = readFileSync(out, "utf8");
		assert.doesNotMatch(cfgArgs, /--clean/);
		assert.match(cfgArgs, /--cmd/);
	});

	it("reports a broken configuration that exits without output", async () => {
		const nvim = fakeExecutable(
			dir,
			"nvim-broken",
			'echo "E5113: Error while calling lua chunk" >&2; exit 1',
		);
		const r = await discoverNeovim(
			{ kind: "neovim", path: nvim, foundVia: "path" },
			config,
			{ mode: "config", workDir: work },
		);
		assert.equal(r.ok, false);
		assert.match(r.error ?? "", /exited with code 1/);
		assert.match(r.stderr ?? "", /E5113/);
	});

	it("times out a configuration that hangs", async () => {
		const nvim = fakeExecutable(dir, "nvim-hang", "sleep 10");
		const r = await discoverNeovim(
			{ kind: "neovim", path: nvim, foundVia: "path" },
			config,
			{ mode: "config", workDir: work, timeoutMs: 300 },
		);
		assert.equal(r.ok, false);
		assert.match(r.error ?? "", /did not finish/);
	});

	it("rejects invalid JSON", async () => {
		const nvim = fakeExecutable(
			dir,
			"nvim-garbage",
			'echo "not json" > "$VIM_COMPANION_OUT"',
		);
		const r = await discoverNeovim(
			{ kind: "neovim", path: nvim, foundVia: "path" },
			config,
			{ mode: "config", workDir: work },
		);
		assert.equal(r.ok, false);
		assert.match(r.error ?? "", /valid JSON/);
	});

	it("handles a missing executable", async () => {
		const r = await discoverNeovim(
			{ kind: "neovim", path: join(dir, "gone"), foundVia: "path" },
			config,
			{ mode: "config", workDir: work },
		);
		assert.equal(r.ok, false);
		assert.match(r.error ?? "", /Could not start Neovim/);
	});
});

describe("Vim discovery pipeline (fake editor)", { skip }, () => {
	const { dir, cleanup } = tempDir();
	after(cleanup);
	const work = join(dir, "work");
	const vimFixture = join(__dirname, "..", "fixtures", "vim-maplist.json");

	it("loads the vimrc in config mode and parses the dump", async () => {
		const out = join(dir, "args.txt");
		const vim = fakeExecutable(
			dir,
			"vim",
			`printf "%s\\n" "$@" > "${out}"; cp "${vimFixture}" "$VIM_COMPANION_OUT"`,
		);
		const r = await discoverVim(
			{ kind: "vim", path: vim, foundVia: "path" },
			{ mode: "config", workDir: work, vimrc: "/home/user/.vimrc" },
		);
		assert.equal(r.ok, true, r.error ?? "");
		assert.ok(r.entries.some((e) => e.keys === "<leader>ff"));
		const args = readFileSync(out, "utf8").split("\n");
		assert.equal(args[args.indexOf("-u") + 1], "/home/user/.vimrc");
		assert.ok(args.includes("-es"));
	});

	it("uses Vim defaults in safe mode", async () => {
		const out = join(dir, "args2.txt");
		const vim = fakeExecutable(
			dir,
			"vim2",
			`printf "%s\\n" "$@" > "${out}"; echo '{"maps":[]}' > "$VIM_COMPANION_OUT"`,
		);
		await discoverVim(
			{ kind: "vim", path: vim, foundVia: "path" },
			{ mode: "safe", workDir: work, vimrc: "/home/user/.vimrc" },
		);
		const args = readFileSync(out, "utf8").split("\n");
		assert.equal(args[args.indexOf("-u") + 1], "DEFAULTS");
	});

	it("reports failures", async () => {
		const vim = fakeExecutable(dir, "vim-bad", "exit 2");
		const r = await discoverVim(
			{ kind: "vim", path: vim, foundVia: "path" },
			{ mode: "config", workDir: work },
		);
		assert.equal(r.ok, false);
		assert.match(r.error ?? "", /code 2/);
	});
});
