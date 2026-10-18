import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUILTIN_COMMANDS } from "../../src/data/vim";
import { MODE_LABELS } from "../../src/types/commands";

describe("built-in reference database", () => {
	it("has a substantial number of entries", () => {
		assert.ok(BUILTIN_COMMANDS.length >= 200, `${BUILTIN_COMMANDS.length}`);
	});

	it("has unique ids", () => {
		const ids = BUILTIN_COMMANDS.map((c) => c.id);
		const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
		assert.deepEqual(dupes, []);
	});

	it("has complete, valid entries", () => {
		for (const c of BUILTIN_COMMANDS) {
			assert.ok(c.title.trim(), `${c.id}: title`);
			assert.ok(c.description.trim().length > 15, `${c.id}: description`);
			assert.ok(c.keys.trim(), `${c.id}: keys`);
			assert.ok(c.modes.length > 0, `${c.id}: modes`);
			for (const m of c.modes)
				assert.ok(m in MODE_LABELS, `${c.id}: mode ${m}`);
			assert.equal(c.status, "reference");
			assert.ok(c.source === "vim" || c.source === "neovim", `${c.id}: source`);
			assert.ok(
				c.keywords.length + c.aliases.length > 0,
				`${c.id}: searchable terms`,
			);
		}
	});

	it("never uses em dashes", () => {
		for (const c of BUILTIN_COMMANDS) {
			const text = [
				c.title,
				c.description,
				c.notes ?? "",
				...(c.examples ?? []),
				...c.aliases,
			].join(" ");
			assert.ok(!text.includes("—"), c.id);
		}
	});

	it("marks Neovim-only defaults with their requirement", () => {
		for (const c of BUILTIN_COMMANDS.filter(
			(c) => c.source === "neovim" && c.keys !== "K",
		)) {
			assert.ok(c.availabilityReason, c.id);
		}
	});

	it("covers every major category", () => {
		const cats = new Set(BUILTIN_COMMANDS.map((c) => c.category));
		for (const cat of [
			"Motion",
			"Text Objects",
			"Editing",
			"Search & Replace",
			"Visual Mode",
			"Registers & Clipboard",
			"Undo & Redo",
			"Marks & Jumps",
			"Buffers",
			"Windows",
			"Tabs",
			"Macros",
			"Folding",
			"Indent & Format",
			"Command Line",
			"Files",
			"Completion",
			"Repetition",
		]) {
			assert.ok(cats.has(cat as never), cat);
		}
	});
});
