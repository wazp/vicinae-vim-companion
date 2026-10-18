import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUILTIN_COMMANDS } from "../../src/data/vim";
import { SearchIndex } from "../../src/search/search";

const index = new SearchIndex(BUILTIN_COMMANDS);

/**
 * [query, expected keys, rank the result must reach (1 = top result)].
 * These verify ranking, not mere presence.
 */
const CASES: Array<[string, string, number?]> = [
	// Spec examples
	["replace word", "ciw"],
	["delete line", "dd"],
	["copy line", "yy"],
	["undo change", "u"],
	["redo change", "<C-r>"],
	["repeat last edit", "."],
	["select inside quotes", 'vi"'],
	["delete inside brackets", "di("],
	["beginning of file", "gg"],
	["end of file", "G"],
	["delete between quotes", 'di"'],
	["select inside brackets", "vi("],
	["undo", "u"],
	["move to matching bracket", "%"],
	["rename symbol", "grn"],
	["repeat last change", "."],
	["change current word", "ciw"],
	["replace current word", "ciw"],
	["delete inside parentheses", "di("],
	["copy to system clipboard", '"+y'],
	["go to last edit", "`.", 1],
	["search files by name", ":find {file}"],
	["delete everything inside brackets", "di("],
	["switch buffers", ":b {name}", 2],
	["search project", ":grep {pattern} {files}", 2],
	// Composer
	["change inside parentheses", "ci("],
	["select around braces", "va{"],
	["copy inside brackets", "yi("],
	["delete around braces", "da{"],
	["change inside quotes", 'ci"'],
	["uppercase word", "gUiw"],
	["yank word", "yiw"],
	["wrap paragraph", "gqip"],
	// Everyday intents
	["paste from clipboard", '"+p'],
	["split window vertically", "<C-w>v"],
	["close buffer", ":bd"],
	["next tab", "gt"],
	["record macro", "q{register}"],
	["indent line", ">>"],
	["save and quit", ":wq"],
	["quit without saving", ":q!"],
	["jump back", "<C-o>", 2],
	["toggle comment", "gcc"],
	["join lines", "J"],
	["select all", "ggVG"],
	["sort lines", ":sort"],
	["remove trailing whitespace", ":%s/\\s\\+$//e"],
	["go to line 42", ":{number}"],
	["scroll down", "<C-d>"],
	["center screen", "zz"],
	["multiple cursors", "<C-v>"],
	["code action", "gra"],
	["find references", "grr"],
	["next error", "]d", 2],
	["count matches", ":%s/{pattern}//gn"],
	["search and replace", ":%s/{old}/{new}/g"],
	["replace all", ":%s/{old}/{new}/g"],
	["open file explorer", ":Ex"],
	["start of line", "0"],
	["end of line", "$"],
	["delete to end of line", "D"],
	["duplicate line", "yyp"],
	["move line down", ":m {address}", 2],
	["insert at end of line", "A"],
	["new line below", "o"],
	["exit insert mode", "<Esc>"],
	["increment number", "<C-a>"],
	["swap characters", "xp"],
	["delete without copying", '"_d'],
	["go to definition", "gd"],
	["show registers", ":reg"],
	["next paragraph", "}"],
	["previous word", "b"],
	["top of screen", "H"],
	["word count", "g<C-g>"],
	["back to previous file", "<C-^>"],
	["close other windows", "<C-w>o"],
	["replace character", "r{char}"],
	["fix spelling", "z="],
	["open terminal", ":terminal"],
	["complete file path", "<C-x><C-f>"],
	["set mark", "m{a-z}"],
	["reindent file", "gg=G"],
	["convert tabs to spaces", ":retab"],
	// Typos
	["delte line", "dd"],
	["coppy line", "yy"],
	["undo chnage", "u"],
	["splt window vertically", "<C-w>v"],
	// Exact keystrokes and key notation
	["ciw", "ciw"],
	["<C-r>", "<C-r>"],
	["ctrl-r", "<C-r>"],
	["ctrl+w v", "<C-w>v"],
	["^R", "<C-r>"],
	["gg", "gg"],
	["G", "G"],
	["3dd", "dd"],
	["dt,", "dt{char}"],
	["noh", ":noh"],
	["<c-W>V", "<C-w>v"],
];

describe("search ranking", () => {
	for (const [query, expected, rank = 1] of CASES) {
		it(`"${query}" ranks ${expected} in the top ${rank}`, () => {
			const results = index.search(query, { limit: 10 });
			const keys = results.map((r) => r.entry.keys);
			const pos = keys.indexOf(expected);
			assert.ok(
				pos >= 0 && pos < rank,
				`expected ${expected} within top ${rank}, got [${keys.slice(0, 5).join(", ")}]`,
			);
		});
	}

	it("has at least 50 ranking cases", () => {
		assert.ok(CASES.length >= 50);
	});

	it("is fast enough for interactive typing", () => {
		const start = performance.now();
		for (const [query] of CASES) index.search(query);
		const perQuery = (performance.now() - start) / CASES.length;
		assert.ok(perQuery < 20, `average ${perQuery.toFixed(2)}ms per query`);
	});
});

describe("search behavior", () => {
	it("returns nothing for an empty query", () => {
		assert.deepEqual(index.search("   "), []);
	});

	it("returns nothing for gibberish", () => {
		assert.deepEqual(index.search("xqzzv plorbnik"), []);
	});

	it("prefers exact keystrokes over generated suggestions", () => {
		const [top] = index.search("di(");
		assert.equal(top.entry.keys, "di(");
		assert.equal(top.match, "exact-keys");
	});

	it("distinguishes cw from ciw", () => {
		const cw = BUILTIN_COMMANDS.find((c) => c.keys === "cw");
		const ciw = BUILTIN_COMMANDS.find((c) => c.keys === "ciw");
		assert.ok(cw && ciw);
		assert.notEqual(cw.description, ciw.description);
		const results = index
			.search("change rest of word")
			.map((r) => r.entry.keys);
		assert.equal(results[0], "cw");
	});

	it("keeps the same keys in different modes as separate results", () => {
		const results = index
			.search("u", { limit: 10 })
			.filter((r) => r.entry.keys === "u");
		const modes = results.map((r) => r.entry.modes.join(""));
		assert.ok(modes.includes("n") && modes.includes("x"), `modes: ${modes}`);
	});

	it("completes partially typed words", () => {
		const keys = index
			.search("delete li", { limit: 5 })
			.map((r) => r.entry.keys);
		assert.ok(keys.includes("dd"), keys.join(", "));
	});

	it("demotes Neovim-only defaults when the editor is Vim", () => {
		const nvim = index.search("toggle comment", { editor: "neovim" })[0];
		const vim = index.search("toggle comment", { editor: "vim" })[0];
		assert.ok(vim.score < nvim.score);
	});

	it("respects the result limit", () => {
		assert.ok(index.search("line", { limit: 3 }).length <= 3);
	});
});
