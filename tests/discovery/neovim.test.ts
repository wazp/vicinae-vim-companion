import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { parseNeovimDump } from "../../src/discovery/neovim";
import type { NvimDump } from "../../src/discovery/types";

const fixture = (name: string) =>
	JSON.parse(
		readFileSync(join(__dirname, "..", "fixtures", name), "utf8"),
	) as NvimDump;

describe("Neovim dump parsing (LazyVim fixture)", () => {
	const report = parseNeovimDump(fixture("nvim-lazyvim.json"), {
		mode: "config",
	});
	const find = (keys: string, status?: string) =>
		report.entries.filter(
			(e) => e.keys === keys && (!status || e.status === status),
		);

	it("detects LazyVim with version and extras", () => {
		assert.equal(report.lazyvim?.detected, true);
		assert.equal(report.lazyvim?.version, "15.13.0");
		assert.deepEqual(report.lazyvim?.extras, [
			"lazyvim.plugins.extras.lang.typescript",
			"lazyvim.plugins.extras.editor.snacks_picker",
		]);
	});

	it("reports leader keys", () => {
		assert.equal(report.leader, " ");
		assert.equal(report.localLeader, "\\");
	});

	it("expands leader for display without assuming Space", () => {
		const [ff] = find("<leader>ff");
		assert.ok(ff);
		assert.equal(ff.keysExpanded, "<Space>ff");
		assert.equal(ff.keysDisplay, "Space f f");
	});

	it("attributes Neovim defaults", () => {
		const [y] = find("Y");
		assert.equal(y.source, "neovim");
		assert.equal(y.title, "Default: y$");
		assert.match(y.notes ?? "", /:help Y-default/);
		const [diag] = find("<C-w><C-d>");
		assert.equal(
			diag.source,
			"neovim",
			"pre-existing Lua mapping without a recorded origin",
		);
		const [match] = find("%");
		assert.equal(match.source, "neovim");
		assert.equal(match.sourceName, "matchit");
	});

	it("attributes LazyVim keymaps using the recorded definition site", () => {
		const [cj] = find("<C-j>");
		assert.equal(cj.source, "lazyvim");
		assert.equal(cj.sourceName, "LazyVim");
		assert.match(cj.context ?? "", /lazyvim\/config\/keymaps\.lua:15/);
	});

	it("groups one mapping defined for several modes", () => {
		const save = find("<C-s>");
		assert.equal(save.length, 1);
		assert.deepEqual(save[0].modes, ["n", "x", "i"]);
	});

	it("attributes lazy.nvim key stubs to the owning plugin", () => {
		const [ff] = find("<leader>ff");
		assert.equal(ff.source, "plugin");
		assert.equal(ff.sourceName, "Snacks");
		assert.equal(ff.status, "active");
		assert.equal(ff.notes, undefined, "snacks is loaded, so no lazy-load note");
		const [s] = find("s");
		assert.equal(s.sourceName, "Flash");
		assert.match(s.notes ?? "", /lazy-loaded/);
	});

	it("labels user mappings as user configuration, not LazyVim", () => {
		const [gs] = find("<leader>gs");
		assert.equal(gs.source, "custom");
		assert.equal(gs.sourceName, undefined);
		assert.match(gs.context ?? "", /lua\/config\/keymaps\.lua:4/);
	});

	it("derives a title from the rhs when there is no description", () => {
		const [x] = find(",x");
		assert.equal(
			x.title,
			":!chmod +x %<CR>".replace(/<CR>$/, "").replace(/^:/, ":"),
		);
	});

	it("keeps buffer-local mappings separate and labeled", () => {
		const [q] = find("q");
		assert.equal(q.status, "buffer-local");
		assert.match(q.context ?? "", /Buffer-local/);
	});

	it("skips <Plug> and which_key_ignore mappings", () => {
		assert.equal(
			report.entries.filter((e) => e.keys.includes("<Plug>")).length,
			0,
		);
		assert.equal(find("<leader>wk").length, 0);
	});

	it("lists declared-but-unmapped plugin keys separately from active ones", () => {
		const [e] = find("<leader>e");
		assert.equal(e.status, "declared");
		assert.equal(e.sourceName, "Neo-tree");
		assert.equal(
			find("<leader>ff", "declared").length,
			0,
			"already active, not duplicated",
		);
	});

	it("marks filetype-specific keys as conditional", () => {
		const [cp] = find("<leader>cp");
		assert.equal(cp.status, "conditional");
		assert.match(cp.context ?? "", /markdown/);
	});

	it("omits keys of disabled plugins", () => {
		assert.equal(find("<leader>zz").length, 0);
	});

	it("represents LSP keymaps as conditional, never active", () => {
		const lsp = report.entries.filter((e) => e.sourceName === "LSP");
		assert.equal(lsp.length, 3);
		for (const e of lsp) assert.equal(e.status, "conditional");
		const [gd] = lsp.filter((e) => e.keys === "gd");
		assert.match(gd.context ?? "", /supports definition/);
		const [co] = lsp.filter((e) => e.keys === "<leader>co");
		assert.match(co.context ?? "", /vtsls/);
	});

	it("counts entries by status", () => {
		const total = Object.values(report.counts).reduce(
			(a, b) => a + (b ?? 0),
			0,
		);
		assert.equal(total, report.entries.length);
		assert.ok((report.counts.conditional ?? 0) >= 4);
	});
});

describe("Neovim dump parsing (plain lazy.nvim)", () => {
	const report = parseNeovimDump(fixture("nvim-plain-lazy.json"), {
		mode: "config",
	});

	it("does not report LazyVim just because lazy.nvim is used", () => {
		assert.equal(report.lazyvim?.detected, false);
		assert.equal(
			report.entries.filter((e) => e.source === "lazyvim").length,
			0,
		);
		assert.equal(report.lazy?.pluginCount, 1);
	});

	it("honors a non-Space leader", () => {
		const [f] = report.entries.filter((e) => e.keys === "<leader>f");
		assert.ok(f);
		assert.equal(f.keysDisplay, ", f");
		assert.equal(f.sourceName, "Telescope");
	});

	it("labels init.lua mappings as user configuration", () => {
		const [w] = report.entries.filter((e) => e.keys === "<leader>w");
		assert.equal(w.source, "custom");
		assert.equal(w.title, ":w");
	});
});

describe("Neovim dump parsing (edge cases)", () => {
	it("handles an empty dump", () => {
		const r = parseNeovimDump({}, { mode: "config" });
		assert.deepEqual(r.entries, []);
		assert.equal(r.lazyvim?.detected, false);
		assert.ok(r.limitations.some((l) => /Definition sites/.test(l)));
	});

	it("notes safe mode", () => {
		const r = parseNeovimDump({ maps: [] }, { mode: "safe" });
		assert.match(r.limitations[0], /Safe mode/);
	});

	it("passes through script errors", () => {
		const r = parseNeovimDump({ errors: ["lazy: boom"] }, { mode: "config" });
		assert.deepEqual(r.scriptErrors, ["lazy: boom"]);
	});
});
