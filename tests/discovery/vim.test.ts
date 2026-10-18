import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { VimDump } from "../../src/discovery/types";
import { parseVerboseMap, parseVimDump } from "../../src/discovery/vim";

const fixtures = join(__dirname, "..", "fixtures");
const HOME = "/home/user";

describe("Vim maplist() parsing", () => {
	const dump = JSON.parse(
		readFileSync(join(fixtures, "vim-maplist.json"), "utf8"),
	) as VimDump;
	const r = parseVimDump(dump, {
		mode: "config",
		vimrc: "/home/user/.vimrc",
		home: HOME,
	});
	const find = (k: string) => r.entries.filter((e) => e.keys === k);

	it("parses mappings with leader expansion", () => {
		const [ff] = find("<leader>ff");
		assert.ok(ff);
		assert.equal(ff.keysDisplay, "Space f f");
		assert.equal(ff.title, ":Files");
		assert.equal(ff.source, "custom");
		assert.equal(ff.editor, "vim");
	});

	it("expands :map (nvo) mode", () => {
		const [w] = find("<leader>w");
		assert.deepEqual(w.modes, ["n", "x", "o"]);
	});

	it("attributes runtime and plugin mappings", () => {
		const [gx] = find("gx");
		assert.equal(gx.source, "vim");
		assert.equal(gx.sourceName, "netrw");
		const [cs] = find("cs");
		assert.equal(cs.source, "plugin");
		assert.equal(cs.sourceName, "vim-surround");
	});

	it("skips <Plug> left-hand sides", () => {
		assert.equal(r.entries.filter((e) => e.keys.includes("<Plug>")).length, 0);
	});

	it("does not require Lua or Neovim fields", () => {
		for (const e of r.entries) assert.equal(e.editor, "vim");
		assert.equal(r.leader, " ");
		assert.equal(r.localLeader, undefined);
	});
});

describe("Vim :verbose map parsing", () => {
	const text = readFileSync(join(fixtures, "vim-verbose-map.txt"), "utf8");

	it("parses modes, flags, rhs and origins", () => {
		const maps = parseVerboseMap(text, HOME);
		assert.equal(maps.length, 6);
		assert.deepEqual(maps[0], {
			mode: "n",
			lhs: "<Space>ff",
			rhs: ":Files<CR>",
			buffer: false,
			origin: "/home/user/.vimrc:12",
		});
		assert.equal(maps[1].mode, " ");
		const q = maps.find((m) => m.lhs === "q");
		assert.equal(q?.buffer, true);
		assert.equal(q?.rhs, ":close<CR>");
	});

	it("feeds the same pipeline as maplist()", () => {
		const r = parseVimDump(
			{ text, leader: " " },
			{ mode: "config", vimrc: "/home/user/.vimrc", home: HOME },
		);
		assert.ok(r.entries.some((e) => e.keys === "<leader>ff"));
		assert.ok(
			r.entries.some((e) => e.keys === "q" && e.status === "buffer-local"),
		);
		assert.ok(r.limitations.some((l) => /maplist/.test(l)));
		const cs = r.entries.find((e) => e.keys === "cs");
		assert.equal(cs?.sourceName, "vim-surround");
	});

	it("ignores 'No mapping found'", () => {
		assert.deepEqual(parseVerboseMap("\nNo mapping found\n"), []);
	});
});
