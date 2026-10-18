import { createHash } from "node:crypto";
import {
	mkdir,
	readdir,
	readFile,
	rename,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import type { DiscoveryReport, EnvironmentInfo } from "../discovery/types";

/** Bump whenever the cached shape or the parsers change, so old caches are rebuilt. */
export const CACHE_VERSION = 1;
export const CACHE_FILE = `keymaps-v${CACHE_VERSION}.json`;

export interface CacheData {
	version: number;
	savedAt: number;
	fingerprint: string;
	environment: EnvironmentInfo;
	reports: DiscoveryReport[];
}

function isCacheData(v: unknown): v is CacheData {
	if (!v || typeof v !== "object") return false;
	const d = v as Partial<CacheData>;
	return (
		d.version === CACHE_VERSION &&
		typeof d.savedAt === "number" &&
		typeof d.fingerprint === "string" &&
		typeof d.environment === "object" &&
		d.environment !== null &&
		Array.isArray(d.reports) &&
		d.reports.every((r) => r && Array.isArray(r.entries))
	);
}

/** Read the cache. Missing, corrupt or old-version caches return undefined. */
export async function readCache(dir: string): Promise<CacheData | undefined> {
	try {
		const parsed = JSON.parse(
			await readFile(join(dir, CACHE_FILE), "utf8"),
		) as unknown;
		return isCacheData(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/** Atomic write: temp file + rename, so readers never see a partial file. */
export async function writeCache(
	dir: string,
	data: Omit<CacheData, "version">,
): Promise<void> {
	await mkdir(dir, { recursive: true });
	const tmp = join(dir, `${CACHE_FILE}.${process.pid}.${Date.now()}.tmp`);
	await writeFile(tmp, JSON.stringify({ version: CACHE_VERSION, ...data }));
	await rename(tmp, join(dir, CACHE_FILE));
}

export async function clearCache(dir: string): Promise<void> {
	await rm(join(dir, CACHE_FILE), { force: true });
}

const CONFIG_EXT = /\.(lua|vim|json|fnl|vimrc)$/;
const SKIP_DIRS = new Set([
	".git",
	"node_modules",
	".cache",
	"spell",
	"undo",
	"swap",
	"backup",
	"sessions",
]);

/**
 * Stat-only summary of a config tree: newest mtime, file count and total size
 * of config-like files. Bounded so a huge directory cannot stall startup.
 */
export async function treeSignature(
	path: string,
	maxEntries = 3000,
	maxDepth = 6,
): Promise<string> {
	let newest = 0;
	let count = 0;
	let size = 0;
	let visited = 0;
	async function walk(p: string, depth: number): Promise<void> {
		if (visited++ > maxEntries) return;
		let s: Awaited<ReturnType<typeof stat>>;
		try {
			s = await stat(p);
		} catch {
			return;
		}
		if (s.isDirectory()) {
			if (depth > maxDepth) return;
			let names: string[];
			try {
				names = await readdir(p);
			} catch {
				return;
			}
			for (const n of names)
				if (!SKIP_DIRS.has(n)) await walk(join(p, n), depth + 1);
		} else if (s.isFile() && (depth === 0 || CONFIG_EXT.test(p))) {
			newest = Math.max(newest, s.mtimeMs);
			count++;
			size += s.size;
		}
	}
	await walk(path, 0);
	return `${Math.round(newest)}:${count}:${size}`;
}

export interface FingerprintInput {
	settings: Record<string, unknown>;
	executables: Array<string | undefined>;
	configPaths: Array<string | undefined>;
}

/** Cheap change detection: no editor is launched to compute it. */
export async function computeFingerprint(
	input: FingerprintInput,
): Promise<string> {
	const parts: string[] = [JSON.stringify(input.settings)];
	for (const exe of input.executables) {
		if (!exe) {
			parts.push("-");
			continue;
		}
		try {
			const s = await stat(exe);
			parts.push(`${exe}:${Math.round(s.mtimeMs)}:${s.size}`);
		} catch {
			parts.push(`${exe}:missing`);
		}
	}
	for (const p of input.configPaths)
		parts.push(p ? `${p}=${await treeSignature(p)}` : "-");
	return createHash("sha256")
		.update(parts.join("\n"))
		.digest("hex")
		.slice(0, 32);
}
