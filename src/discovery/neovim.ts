import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CommandEntry, Mode } from "../types/commands";
import { normalizeKeys } from "../utils/keys";
import { excerpt, runProcess } from "../utils/process";
import { attributeOrigin, prettyPluginName } from "./attribution";
import { buildRuntimeEntry, countByStatus, expandModes } from "./mappings";
import { prepareSandbox } from "./sandbox";
import { NVIM_MAIN_SCRIPT, NVIM_PRE_SCRIPT } from "./scripts";
import type {
	DiscoveryReport,
	EditorInfo,
	NeovimConfigInfo,
	NvimDump,
} from "./types";

const MAX_DUMP_BYTES = 8 * 1024 * 1024;

export const NEOVIM_LIMITATIONS = [
	"Only mappings that exist after startup are listed. Mappings created when a filetype is opened, an LSP server attaches, or a plugin loads later may be missing.",
	"Buffer-local mappings are taken from a single empty scratch buffer.",
	"Lua callbacks are never executed; mappings without a description show only their keys.",
];

export interface NeovimDiscoveryOptions {
	mode: "config" | "safe";
	/** Extension-owned working directory (scripts, stubs, output). */
	workDir: string;
	timeoutMs?: number;
	baseEnv?: NodeJS.ProcessEnv;
}

/**
 * Start Neovim headlessly, run the extraction script and parse its output.
 *
 * Trust boundary: in "config" mode Neovim loads the user's configuration,
 * which executes its startup code. This is not a sandbox. To avoid side
 * effects, common network/build tools are shadowed on PATH by stubs that
 * fail, lazy.nvim's update checker is disabled, and shada/swap are off.
 */
export async function discoverNeovim(
	nvim: EditorInfo,
	config: NeovimConfigInfo,
	options: NeovimDiscoveryOptions,
): Promise<DiscoveryReport> {
	const started = Date.now();
	const base: DiscoveryReport = {
		editor: "neovim",
		mode: options.mode,
		ok: false,
		durationMs: 0,
		scriptErrors: [],
		counts: {},
		limitations: [...NEOVIM_LIMITATIONS],
		entries: [],
	};
	let runDir: string | undefined;
	try {
		const sandbox = await prepareSandbox(options.workDir);
		runDir = join(options.workDir, "runs", `nvim-${process.pid}-${started}`);
		await mkdir(runDir, { recursive: true });
		const pre = join(runDir, "pre.lua");
		const main = join(runDir, "main.lua");
		const out = join(runDir, "out.json");
		await writeFile(pre, NVIM_PRE_SCRIPT);
		await writeFile(main, NVIM_MAIN_SCRIPT);

		const env: NodeJS.ProcessEnv = {
			...(options.baseEnv ?? process.env),
			...config.env,
			PATH: sandbox.path(options.baseEnv?.PATH ?? process.env.PATH),
			VIM_COMPANION_OUT: out,
			GIT_TERMINAL_PROMPT: "0",
		};
		const args =
			options.mode === "safe"
				? [
						"--clean",
						"--headless",
						"-n",
						"-i",
						"NONE",
						"-c",
						`luafile ${luaPath(main)}`,
					]
				: [
						"--headless",
						"-n",
						"-i",
						"NONE",
						"--cmd",
						`luafile ${luaPath(pre)}`,
						"-c",
						`luafile ${luaPath(main)}`,
					];
		const res = await runProcess(nvim.path, args, {
			env,
			timeoutMs: options.timeoutMs ?? 20_000,
			maxBuffer: 256 * 1024,
			cwd: runDir,
		});
		base.stderr = excerpt(`${res.stderr}\n${res.stdout}`) || undefined;
		if (res.spawnError)
			return {
				...base,
				error: `Could not start Neovim: ${res.spawnError}`,
				durationMs: Date.now() - started,
			};

		let raw: string;
		try {
			raw = await readFile(out, "utf8");
		} catch {
			const why = res.timedOut
				? `Neovim did not finish within ${Math.round((options.timeoutMs ?? 20_000) / 1000)}s`
				: `Neovim exited with code ${res.code} without producing output`;
			return {
				...base,
				error: `${why}. The configuration may be waiting for input or failing during startup.`,
				durationMs: Date.now() - started,
			};
		}
		if (raw.length > MAX_DUMP_BYTES)
			return {
				...base,
				error: "Discovery output was unexpectedly large and was ignored.",
				durationMs: Date.now() - started,
			};
		let dump: NvimDump;
		try {
			dump = JSON.parse(raw) as NvimDump;
		} catch {
			return {
				...base,
				error: "Discovery output was not valid JSON.",
				durationMs: Date.now() - started,
			};
		}
		const parsed = parseNeovimDump(dump, {
			configDir: config.configDir,
			mode: options.mode,
		});
		return { ...base, ...parsed, ok: true, durationMs: Date.now() - started };
	} catch (e) {
		return {
			...base,
			error: e instanceof Error ? e.message : String(e),
			durationMs: Date.now() - started,
		};
	} finally {
		if (runDir)
			await rm(runDir, { recursive: true, force: true }).catch(() => undefined);
	}
}

/** Paths go into an Ex command; escape spaces and backslashes as Vim expects. */
function luaPath(p: string): string {
	return p.replace(/([\\ ])/g, "\\$1");
}

export interface ParseOptions {
	configDir?: string;
	mode: "config" | "safe";
}

type ParsedReport = Pick<
	DiscoveryReport,
	| "entries"
	| "counts"
	| "leader"
	| "localLeader"
	| "lazy"
	| "lazyvim"
	| "scriptErrors"
	| "limitations"
>;

/** Turn the extraction JSON into normalized entries. Pure; tested with fixtures. */
export function parseNeovimDump(
	dump: NvimDump,
	options: ParseOptions,
): ParsedReport {
	const leader = typeof dump.leader === "string" ? dump.leader : undefined;
	const localLeader =
		typeof dump.localleader === "string" ? dump.localleader : undefined;
	const lazyRoot = dump.lazy?.root;
	const ctx = {
		configDir: dump.config ?? options.configDir,
		runtimeDir: dump.vimruntime,
		lazyRoot,
		editor: "neovim" as const,
	};
	const entries: CommandEntry[] = [];
	const limitations = [...NEOVIM_LIMITATIONS];
	if (options.mode === "safe")
		limitations.unshift(
			"Safe mode: your configuration was not loaded, so only Neovim's built-in default mappings are shown.",
		);
	if (options.mode === "config" && !dump.instrumented)
		limitations.push(
			"Definition sites could not be recorded, so plugin attribution is limited.",
		);

	// lazy.nvim key specs: mode+keys -> plugin
	const disabled = new Set(dump.lazy?.disabled ?? []);
	const lazyKeyOwner = new Map<string, string>();
	for (const p of dump.lazy?.plugins ?? []) {
		for (const k of p.keys ?? []) {
			const join = k.match ?? normalizeKeys(k.lhs);
			for (const m of k.modes)
				for (const mode of expandModes(m))
					lazyKeyOwner.set(`${mode}\0${join}`, p.name);
		}
	}

	// Group identical mappings that appear under several modes.
	interface Group {
		modes: Mode[];
		map: NonNullable<NvimDump["maps"]>[number];
		norm: string;
		join: string;
	}
	const groups = new Map<string, Group>();
	const seenModeKeys = new Set<string>();
	for (const m of dump.maps ?? []) {
		if (
			!m.lhs ||
			/<Plug>|<SNR>|Mouse>|<ScrollWheel/i.test(m.lhs) ||
			m.desc === "which_key_ignore"
		)
			continue;
		const norm = normalizeKeys(m.norm ?? m.lhs);
		const join = m.match ?? norm;
		const modes = expandModes(m.mode);
		const id = [
			norm,
			m.rhs ?? "",
			m.desc ?? "",
			m.origin ?? "",
			m.buffer ? "b" : "g",
			m.callback ? "cb" : "",
		].join("\0");
		const g = groups.get(id) ?? { modes: [], map: m, norm, join };
		for (const mode of modes) if (!g.modes.includes(mode)) g.modes.push(mode);
		groups.set(id, g);
		if (!m.buffer)
			for (const mode of modes) seenModeKeys.add(`${mode}\0${join}`);
	}

	const loaded = new Map(
		(dump.lazy?.plugins ?? []).map((p) => [p.name, p.loaded === true]),
	);
	for (const { modes, map, norm, join } of groups.values()) {
		let attribution = attributeOrigin(map.origin, ctx);
		let context = attribution.context;
		let notes: string | undefined;
		const lazyOwner = modes
			.map((mode) => lazyKeyOwner.get(`${mode}\0${join}`))
			.find(Boolean);
		// Lua mappings that existed before the user's config ran were created by Neovim itself.
		const preexisting =
			!map.origin &&
			(map.sid === -8 || map.sid === undefined || map.sid <= 0) &&
			(dump.instrumented || options.mode === "safe");
		if (/^:help .*-default$/.test(map.desc ?? "") || preexisting) {
			attribution = { source: "neovim", context: "Neovim default" };
			context = attribution.context;
		} else if (
			lazyOwner &&
			(map.via_lazy || attribution.plugin === "lazy.nvim" || !map.origin)
		) {
			attribution =
				lazyOwner === "LazyVim"
					? { source: "lazyvim", sourceName: "LazyVim" }
					: {
							source: "plugin",
							sourceName: prettyPluginName(lazyOwner),
							plugin: lazyOwner,
						};
			context = `Declared in the lazy.nvim spec for ${lazyOwner}`;
			if (!loaded.get(lazyOwner))
				notes = `${lazyOwner} is lazy-loaded: the first press loads the plugin and then runs the mapping.`;
		} else if (attribution.plugin === "lazy.nvim") {
			attribution = { source: "plugin", sourceName: "lazy.nvim" };
		}
		entries.push(
			buildRuntimeEntry({
				editor: "neovim",
				norm,
				modes,
				desc: map.desc,
				rhs: map.rhs,
				callback: map.callback,
				status: map.buffer ? "buffer-local" : "active",
				source: attribution.source,
				sourceName: attribution.sourceName,
				context: map.buffer
					? `Buffer-local in the inspected scratch buffer${context ? ` (${context})` : ""}`
					: context,
				leader,
				localLeader,
				notes,
			}),
		);
	}

	// Keys declared in lazy.nvim specs that have no mapping in this session.
	for (const p of dump.lazy?.plugins ?? []) {
		if (disabled.has(p.name)) continue;
		for (const k of p.keys ?? []) {
			const join = k.match ?? normalizeKeys(k.lhs);
			const norm = normalizeKeys(
				k.lhs
					.replace(/<leader>/gi, leader ?? "\\")
					.replace(/<localleader>/gi, localLeader ?? "\\"),
			);
			const modes = k.modes.flatMap(expandModes);
			if (modes.some((mode) => seenModeKeys.has(`${mode}\0${join}`))) continue;
			const fts = k.ft === undefined ? [] : Array.isArray(k.ft) ? k.ft : [k.ft];
			const isLazyVim = p.name === "LazyVim";
			entries.push(
				buildRuntimeEntry({
					editor: "neovim",
					norm,
					modes,
					desc: k.desc,
					rhs: k.rhs,
					callback: k.rhs === undefined,
					status: fts.length ? "conditional" : "declared",
					source: isLazyVim ? "lazyvim" : "plugin",
					sourceName: isLazyVim ? "LazyVim" : prettyPluginName(p.name),
					context: fts.length
						? `Only in ${fts.join(", ")} buffers (lazy.nvim spec for ${p.name})`
						: `Declared in the lazy.nvim spec for ${p.name}, but no mapping was found in the inspected session`,
					leader,
					localLeader,
					idSuffix: "declared",
				}),
			);
		}
	}

	// LazyVim LSP keymaps: set per buffer when a server attaches.
	for (const k of dump.lazyvim?.lsp_keys ?? []) {
		const norm = normalizeKeys(
			k.lhs
				.replace(/<leader>/gi, leader ?? "\\")
				.replace(/<localleader>/gi, localLeader ?? "\\"),
		);
		const caps = k.has?.length ? ` that supports ${k.has.join(", ")}` : "";
		entries.push(
			buildRuntimeEntry({
				editor: "neovim",
				norm,
				modes: k.modes.flatMap(expandModes),
				desc: k.desc,
				callback: true,
				status: "conditional",
				source: "lazyvim",
				sourceName: "LSP",
				context: `Buffer-local: set when ${k.server && k.server !== "*" ? `the ${k.server} server` : "an LSP server"} attaches${caps}`,
				leader,
				localLeader,
				idSuffix: `lsp-${k.server ?? "*"}`,
			}),
		);
	}

	const plugins = dump.lazy?.plugins;
	return {
		entries,
		counts: countByStatus(entries),
		leader,
		localLeader,
		lazy: plugins
			? {
					pluginCount: plugins.length,
					loadedCount: plugins.filter((p) => p.loaded).length,
					disabledCount: disabled.size,
				}
			: undefined,
		lazyvim: dump.lazyvim
			? {
					detected: true,
					version: dump.lazyvim.version,
					extras: dump.lazyvim.extras ?? [],
				}
			: { detected: false, extras: [] },
		scriptErrors: dump.errors ?? [],
		limitations,
	};
}
