import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { BUILTIN_COMMANDS } from "../../src/data/vim";
import { parseNeovimDump } from "../../src/discovery/neovim";
import type { DiscoveryReport, NvimDump } from "../../src/discovery/types";
import { SearchIndex } from "../../src/search/search";
import { buildCatalog } from "../../src/services/catalog";
import {
	DEFAULT_SETTINGS,
	parseLeader,
	parseSettings,
	type Settings,
} from "../../src/types/settings";

const dump = JSON.parse(
	readFileSync(join(__dirname, "..", "fixtures", "nvim-lazyvim.json"), "utf8"),
) as NvimDump;
const parsed = parseNeovimDump(dump, { mode: "config" });
const report: DiscoveryReport = {
	editor: "neovim",
	mode: "config",
	ok: true,
	durationMs: 1,
	...parsed,
};
const catalog = (settings: Partial<Settings> = {}) =>
	buildCatalog({
		builtins: BUILTIN_COMMANDS,
		reports: [report],
		settings: { ...DEFAULT_SETTINGS, ...settings },
		activeEditor: "neovim",
	});

describe("catalog merging", () => {
	it("includes both reference entries and discovered mappings", () => {
		const all = catalog();
		assert.ok(all.some((e) => e.status === "reference"));
		assert.ok(all.some((e) => e.category === "Keymaps"));
	});

	it("marks reference entries that the user's config overrides", () => {
		const s = catalog().find(
			(e) => e.id.startsWith("ref:") && e.keys === "s" && e.modes.includes("n"),
		);
		assert.equal(s?.status, "overridden");
		assert.match(s?.context ?? "", /Flash/);
	});

	it("folds confirmed Neovim defaults into the reference entry", () => {
		const all = catalog();
		const gcc = all.filter((e) => e.keys === "gcc");
		assert.equal(gcc.length, 1, "no duplicate runtime gcc");
		assert.equal(gcc[0].status, "active");
	});

	it("does not override with conditional LSP mappings", () => {
		const gd = catalog().find(
			(e) => e.id.startsWith("ref:") && e.keys === "gd",
		);
		assert.equal(gd?.status, "reference");
	});

	it("respects the source preferences", () => {
		assert.equal(
			catalog({ includeBuiltins: false }).filter(
				(e) => e.status === "reference",
			).length,
			0,
		);
		assert.equal(
			catalog({ includePlugins: false }).filter((e) => e.source === "plugin")
				.length,
			0,
		);
		const noCustom = catalog({ includeCustom: false });
		assert.equal(
			noCustom.filter((e) => e.category === "Keymaps" && e.source !== "plugin")
				.length,
			0,
		);
		assert.ok(noCustom.some((e) => e.source === "plugin"));
	});

	it("applies a leader display override", () => {
		const ff = catalog({ leaderOverride: "," }).find(
			(e) => e.keys === "<leader>ff",
		);
		assert.equal(ff?.keysDisplay, ", f f");
	});

	it("works with no runtime data at all", () => {
		const only = buildCatalog({
			builtins: BUILTIN_COMMANDS,
			reports: [],
			settings: DEFAULT_SETTINGS,
		});
		assert.equal(only.length, BUILTIN_COMMANDS.length);
	});
});

describe("searching discovered mappings", () => {
	const index = new SearchIndex(catalog());

	it("finds custom mappings by description", () => {
		const [top] = index.search("git status", { editor: "neovim" });
		assert.equal(top.entry.keys, "<leader>gs");
	});

	it("finds mappings by typed leader keys", () => {
		const [top] = index.search("<leader>ff");
		assert.equal(top.entry.keys, "<leader>ff");
		const [spaced] = index.search("<space>ff");
		assert.equal(spaced.entry.keys, "<leader>ff");
		const [spelled] = index.search("space f f");
		assert.equal(spelled.entry.keys, "<leader>ff");
	});

	it("surfaces LSP go-to-definition for 'move to definition'", () => {
		const keys = index
			.search("move to definition", { editor: "neovim" })
			.slice(0, 3)
			.map((r) => `${r.entry.keys}:${r.entry.status}`);
		assert.ok(keys.includes("gd:conditional"), keys.join(", "));
	});

	it("keeps the same keys in different modes and sources apart", () => {
		const save = index
			.search("save file", { limit: 10 })
			.filter((r) => r.entry.keys === "<C-s>");
		assert.equal(save.length, 1);
		assert.deepEqual(save[0].entry.modes, ["n", "x", "i"]);
	});

	it("finds plugin mappings", () => {
		const [top] = index.search("find files", { editor: "neovim" });
		assert.equal(top.entry.keys, "<leader>ff");
	});
});

describe("settings", () => {
	it("defaults everything for an empty preference set", () => {
		assert.deepEqual(
			JSON.parse(JSON.stringify(parseSettings({}))),
			DEFAULT_SETTINGS,
		);
	});

	it("parses values and rejects junk", () => {
		const s = parseSettings({
			preferredEditor: "vim",
			runtimeDiscovery: "safe",
			resultLimit: "100",
			nvimAppName: " lazyvim ",
			includePlugins: false,
			leaderOverride: "Space",
		});
		assert.equal(s.preferredEditor, "vim");
		assert.equal(s.runtimeDiscovery, "safe");
		assert.equal(s.resultLimit, 100);
		assert.equal(s.nvimConfig, "lazyvim");
		assert.equal(s.includePlugins, false);
		assert.equal(s.leaderOverride, " ");
		assert.equal(
			parseSettings({ preferredEditor: "emacs", resultLimit: "-3" })
				.preferredEditor,
			"auto",
		);
		assert.equal(parseSettings({ resultLimit: "abc" }).resultLimit, 50);
	});

	it("understands leader spellings", () => {
		assert.equal(parseLeader("<Space>"), " ");
		assert.equal(parseLeader(" "), " ");
		assert.equal(parseLeader("backslash"), "\\");
		assert.equal(parseLeader(","), ",");
	});
});
