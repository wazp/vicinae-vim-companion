import type { DiscoveryReport } from "../discovery/types";
import type { CommandEntry, Mode } from "../types/commands";
import { MODE_LABELS, SOURCE_LABELS } from "../types/commands";
import type { Settings } from "../types/settings";
import { displayKeys, normalizeKeys } from "../utils/keys";

export interface CatalogInput {
	builtins: CommandEntry[];
	reports: DiscoveryReport[];
	settings: Settings;
	/** The editor whose runtime mappings decide overrides. */
	activeEditor?: "vim" | "neovim";
}

function isPluginEntry(e: CommandEntry): boolean {
	return e.source === "plugin";
}

/**
 * Combine the curated reference with discovered mappings:
 * - applies the source preferences,
 * - folds Neovim's own default mappings into matching reference entries,
 * - marks reference entries that the user's config overrides,
 * - re-renders leader keys when a display override is set.
 */
export function buildCatalog(input: CatalogInput): CommandEntry[] {
	const { settings } = input;
	const runtime: CommandEntry[] = [];
	for (const report of input.reports) {
		for (const e of report.entries) {
			if (isPluginEntry(e) ? !settings.includePlugins : !settings.includeCustom)
				continue;
			runtime.push(e);
		}
	}

	// Index active global runtime mappings of the active editor by mode + real keys.
	const activeByKey = new Map<string, CommandEntry>();
	for (const e of runtime) {
		if (
			e.status !== "active" ||
			(input.activeEditor && e.editor !== input.activeEditor)
		)
			continue;
		const keys = normalizeKeys(e.keysExpanded ?? e.keys);
		for (const m of e.modes) {
			activeByKey.set(`${m}\0${keys}`, e);
			if (m === "x") activeByKey.set(`v\0${keys}`, e);
		}
	}

	const absorbed = new Set<CommandEntry>();
	const builtins: CommandEntry[] = [];
	if (settings.includeBuiltins) {
		for (const ref of input.builtins) {
			if (ref.keys.includes("{") || ref.keys.startsWith(":")) {
				builtins.push(ref);
				continue;
			}
			const keys = normalizeKeys(ref.keys);
			const hits = ref.modes
				.map((m) => [m, activeByKey.get(`${m}\0${keys}`)] as const)
				.filter((h): h is readonly [Mode, CommandEntry] => h[1] !== undefined);
			const confirm = hits.find(([, r]) => r.source === "neovim");
			const override = hits.find(
				([, r]) => r.source !== "neovim" && r.source !== "vim",
			);
			if (override) {
				const [mode, r] = override;
				builtins.push({
					...ref,
					status: "overridden",
					context: `In ${MODE_LABELS[mode]} mode your configuration maps ${ref.keys} to "${r.title}" (${r.sourceName ?? SOURCE_LABELS[r.source]}).`,
				});
			} else if (confirm && ref.source === "neovim") {
				absorbed.add(confirm[1]);
				builtins.push({
					...ref,
					status: "active",
					context: "Confirmed as a default mapping in your Neovim",
				});
			} else {
				builtins.push(ref);
			}
		}
	}

	const leader = settings.leaderOverride;
	const runtimeOut = runtime
		.filter((e) => !absorbed.has(e))
		.map((e) => {
			if (leader === undefined || !/<leader>/i.test(e.keys)) return e;
			const report = input.reports.find((r) => r.editor === e.editor);
			return {
				...e,
				keysDisplay: displayKeys(e.keys, leader, report?.localLeader),
			};
		});
	return [...builtins, ...runtimeOut];
}
