import assert from "node:assert/strict";
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
	CACHE_FILE,
	CACHE_VERSION,
	clearCache,
	computeFingerprint,
	readCache,
	treeSignature,
	writeCache,
} from "../../src/services/cache";
import { tempDir } from "../helpers";

const sample = {
	savedAt: 1,
	fingerprint: "abc",
	environment: { detectedAt: 1, warnings: [] },
	reports: [
		{
			editor: "neovim" as const,
			mode: "config" as const,
			ok: true,
			durationMs: 5,
			scriptErrors: [],
			counts: {},
			limitations: [],
			entries: [],
		},
	],
};

describe("keymap cache", () => {
	const { dir, cleanup } = tempDir();
	after(cleanup);

	it("round-trips data with a version stamp", async () => {
		await writeCache(dir, sample);
		const raw = JSON.parse(readFileSync(join(dir, CACHE_FILE), "utf8"));
		assert.equal(raw.version, CACHE_VERSION);
		const back = await readCache(dir);
		assert.equal(back?.fingerprint, "abc");
		assert.equal(back?.reports[0].editor, "neovim");
	});

	it("treats corrupt files as missing", async () => {
		writeFileSync(join(dir, CACHE_FILE), "{ not json");
		assert.equal(await readCache(dir), undefined);
	});

	it("ignores caches from another format version", async () => {
		writeFileSync(
			join(dir, CACHE_FILE),
			JSON.stringify({ ...sample, version: CACHE_VERSION + 1 }),
		);
		assert.equal(await readCache(dir), undefined);
	});

	it("rejects structurally invalid data", async () => {
		writeFileSync(
			join(dir, CACHE_FILE),
			JSON.stringify({
				version: CACHE_VERSION,
				savedAt: 1,
				fingerprint: "x",
				environment: {},
				reports: [{}],
			}),
		);
		assert.equal(await readCache(dir), undefined);
	});

	it("clears the cache", async () => {
		await writeCache(dir, sample);
		await clearCache(dir);
		assert.equal(await readCache(dir), undefined);
	});

	it("handles a missing directory", async () => {
		assert.equal(await readCache(join(dir, "nope")), undefined);
	});
});

describe("cache invalidation fingerprint", () => {
	const { dir, cleanup } = tempDir();
	after(cleanup);
	const cfg = join(dir, "nvim");
	mkdirSync(join(cfg, "lua", "config"), { recursive: true });
	const keymaps = join(cfg, "lua", "config", "keymaps.lua");
	writeFileSync(keymaps, "-- keymaps\n");
	writeFileSync(join(cfg, "README.md"), "ignored");

	it("changes when a config file changes", async () => {
		const before = await computeFingerprint({
			settings: {},
			executables: [],
			configPaths: [cfg],
		});
		writeFileSync(keymaps, "vim.keymap.set('n', 'x', 'y')\n");
		const t = new Date(Date.now() + 5000);
		utimesSync(keymaps, t, t);
		const afterChange = await computeFingerprint({
			settings: {},
			executables: [],
			configPaths: [cfg],
		});
		assert.notEqual(before, afterChange);
	});

	it("is stable when nothing changed", async () => {
		const a = await computeFingerprint({
			settings: { x: 1 },
			executables: [keymaps],
			configPaths: [cfg],
		});
		const b = await computeFingerprint({
			settings: { x: 1 },
			executables: [keymaps],
			configPaths: [cfg],
		});
		assert.equal(a, b);
	});

	it("changes with discovery-relevant settings", async () => {
		const a = await computeFingerprint({
			settings: { runtimeDiscovery: "config" },
			executables: [],
			configPaths: [cfg],
		});
		const b = await computeFingerprint({
			settings: { runtimeDiscovery: "safe" },
			executables: [],
			configPaths: [cfg],
		});
		assert.notEqual(a, b);
	});

	it("only counts config-like files", async () => {
		const sig = await treeSignature(cfg);
		assert.match(sig, /^\d+:1:\d+$/);
	});
});
