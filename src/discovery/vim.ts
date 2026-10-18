import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CommandEntry, Mode } from "../types/commands";
import { normalizeKeys } from "../utils/keys";
import { homeDir } from "../utils/paths";
import { excerpt, runProcess } from "../utils/process";
import { attributeOrigin } from "./attribution";
import { buildRuntimeEntry, countByStatus, expandModes } from "./mappings";
import { prepareSandbox } from "./sandbox";
import { VIM_SCRIPT } from "./scripts";
import type { DiscoveryReport, EditorInfo, VimDump } from "./types";

export const VIM_LIMITATIONS = [
	"Only mappings that exist after startup are listed. Filetype plugins and autocommands that create mappings later are not covered.",
	"Vim mappings have no description field, so titles are derived from the right-hand side.",
];

export interface VimDiscoveryOptions {
	mode: "config" | "safe";
	workDir: string;
	vimrc?: string;
	timeoutMs?: number;
	baseEnv?: NodeJS.ProcessEnv;
}

/**
 * Run Vim in silent Ex mode with the user's vimrc, load plugins the way a
 * normal startup would, and dump mappings. Same trust boundary as Neovim:
 * loading a vimrc executes it.
 */
export async function discoverVim(
	vim: EditorInfo,
	options: VimDiscoveryOptions,
): Promise<DiscoveryReport> {
	const started = Date.now();
	const base: DiscoveryReport = {
		editor: "vim",
		mode: options.mode,
		ok: false,
		durationMs: 0,
		scriptErrors: [],
		counts: {},
		limitations: [...VIM_LIMITATIONS],
		entries: [],
	};
	let runDir: string | undefined;
	try {
		const sandbox = await prepareSandbox(options.workDir);
		runDir = join(options.workDir, "runs", `vim-${process.pid}-${started}`);
		await mkdir(runDir, { recursive: true });
		const script = join(runDir, "extract.vim");
		const out = join(runDir, "out.json");
		await writeFile(script, VIM_SCRIPT);
		const useConfig = options.mode === "config" && options.vimrc;
		const args = [
			"-N",
			"-u",
			useConfig ? (options.vimrc as string) : "DEFAULTS",
			"-i",
			"NONE",
			"-n",
			"-es",
			...(useConfig
				? ["-c", "runtime! plugin/**/*.vim", "-c", "silent! packloadall"]
				: []),
			"-c",
			`source ${script.replace(/([\\ ])/g, "\\$1")}`,
		];
		const env = {
			...(options.baseEnv ?? process.env),
			PATH: sandbox.path(options.baseEnv?.PATH ?? process.env.PATH),
			VIM_COMPANION_OUT: out,
			GIT_TERMINAL_PROMPT: "0",
		};
		const res = await runProcess(vim.path, args, {
			env,
			timeoutMs: options.timeoutMs ?? 15_000,
			maxBuffer: 256 * 1024,
			cwd: runDir,
		});
		base.stderr = excerpt(`${res.stderr}\n${res.stdout}`) || undefined;
		if (res.spawnError)
			return {
				...base,
				error: `Could not start Vim: ${res.spawnError}`,
				durationMs: Date.now() - started,
			};
		let dump: VimDump;
		try {
			dump = JSON.parse(await readFile(out, "utf8")) as VimDump;
		} catch {
			const why = res.timedOut
				? "Vim did not finish in time"
				: `Vim exited with code ${res.code} without producing output`;
			return {
				...base,
				error: `${why}. The vimrc may be waiting for input or failing during startup.`,
				durationMs: Date.now() - started,
			};
		}
		return {
			...base,
			...parseVimDump(dump, { vimrc: options.vimrc, mode: options.mode }),
			ok: true,
			durationMs: Date.now() - started,
		};
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

interface RawVimMap {
	mode: string;
	lhs: string;
	rhs?: string;
	origin?: string;
	buffer?: boolean;
}

/**
 * Parse ":verbose map" / ":verbose map!" output (used on Vim versions without
 * maplist()). Lines look like:
 *
 *   n  <Space>ff   * :Files<CR>
 *   \tLast set from ~/.vimrc line 12
 */
export function parseVerboseMap(text: string, home = homeDir()): RawVimMap[] {
	const out: RawVimMap[] = [];
	let last: RawVimMap | undefined;
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim() || /^No mapping found/i.test(line.trim())) continue;
		const set = /^\s+Last set from (.+?)(?: line (\d+))?\s*$/.exec(line);
		if (set) {
			if (last) {
				const path = set[1].startsWith("~/")
					? join(home, set[1].slice(2))
					: set[1];
				last.origin = set[2] ? `${path}:${set[2]}` : path;
			}
			continue;
		}
		if (line.startsWith("\t")) continue;
		const mode = line.slice(0, 3).trim();
		const rest = line.slice(3);
		const m = /^(\S+)\s+([*&@]*)\s*(.*)$/.exec(rest);
		if (!m || !/^[nvxsoilct!]*$/.test(mode)) continue;
		last = {
			mode: mode === "" ? " " : mode,
			lhs: m[1],
			rhs: m[3] || undefined,
			buffer: m[2].includes("@"),
		};
		out.push(last);
	}
	return out;
}

export function parseVimDump(
	dump: VimDump,
	options: { vimrc?: string; mode: "config" | "safe"; home?: string },
): Pick<
	DiscoveryReport,
	| "entries"
	| "counts"
	| "leader"
	| "localLeader"
	| "scriptErrors"
	| "limitations"
> {
	const home = options.home ?? homeDir();
	const leader = typeof dump.leader === "string" ? dump.leader : undefined;
	const localLeader =
		typeof dump.localleader === "string" ? dump.localleader : undefined;
	const limitations = [...VIM_LIMITATIONS];
	if (options.mode === "safe")
		limitations.unshift(
			"Safe mode: your vimrc was not loaded, so only Vim's default mappings are shown.",
		);

	let raw: RawVimMap[];
	if (Array.isArray(dump.maps)) {
		const scripts = new Map((dump.scripts ?? []).map((s) => [s.sid, s.name]));
		raw = dump.maps.map((m) => {
			const script = m.sid !== undefined ? scripts.get(m.sid) : undefined;
			const path = script?.startsWith("~/")
				? join(home, script.slice(2))
				: script;
			return {
				mode: m.mode,
				lhs: m.lhs,
				rhs: m.rhs,
				buffer: Boolean(m.buffer),
				origin: path ? `${path}:${m.lnum ?? 0}` : undefined,
			};
		});
	} else if (typeof dump.text === "string") {
		raw = parseVerboseMap(dump.text, home);
		limitations.push(
			"This Vim has no maplist() (added in 9.0.1004); mappings were parsed from :verbose map output.",
		);
	} else {
		raw = [];
	}

	const vimrc = options.vimrc ?? dump.myvimrc;
	const vimDir = vimrc
		? dirname(vimrc) === home
			? join(home, ".vim")
			: dirname(vimrc)
		: join(home, ".vim");
	const ctx = {
		configDir: vimDir,
		runtimeDir: dump.vimruntime,
		editor: "vim" as const,
	};

	const groups = new Map<
		string,
		{ modes: Mode[]; map: RawVimMap; norm: string }
	>();
	for (const m of raw) {
		if (!m.lhs || /<Plug>|<SNR>|Mouse>/i.test(m.lhs)) continue;
		const norm = normalizeKeys(m.lhs);
		const id = [norm, m.rhs ?? "", m.origin ?? "", m.buffer ? "b" : "g"].join(
			"\0",
		);
		const g = groups.get(id) ?? { modes: [], map: m, norm };
		for (const mode of expandModes(m.mode))
			if (!g.modes.includes(mode)) g.modes.push(mode);
		groups.set(id, g);
	}

	const entries: CommandEntry[] = [];
	for (const { modes, map, norm } of groups.values()) {
		const path = map.origin?.replace(/:\d+$/, "");
		const attribution =
			vimrc && path === vimrc
				? {
						source: "custom" as const,
						context: `${map.origin?.replace(home, "~")}`,
					}
				: attributeOrigin(map.origin, ctx);
		entries.push(
			buildRuntimeEntry({
				editor: "vim",
				norm,
				modes,
				rhs: map.rhs,
				status: map.buffer ? "buffer-local" : "active",
				source: attribution.source,
				sourceName: attribution.sourceName,
				context: attribution.context,
				leader,
				localLeader,
			}),
		);
	}
	return {
		entries,
		counts: countByStatus(entries),
		leader,
		localLeader,
		scriptErrors: dump.errors ?? [],
		limitations,
	};
}
