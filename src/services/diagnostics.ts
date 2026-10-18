import type { DiscoveryReport, EnvironmentInfo } from "../discovery/types";
import { STATUS_LABELS } from "../types/commands";
import type { Settings } from "../types/settings";
import { leaderLabel } from "../utils/keys";
import { codeSpan } from "../utils/markdown";

const DISCOVERY_LABEL: Record<Settings["runtimeDiscovery"], string> = {
	config: "Load configuration (runs startup code)",
	safe: "Safe (editor defaults only)",
	off: "Off (built-in reference only)",
};

function leaderText(leader: string | undefined): string {
	if (leader === undefined) return "not set (Vim default is \\)";
	return `${codeSpan(leader === " " ? "<Space>" : leader)} (${leaderLabel(leader) ?? leader})`;
}

function reportSection(r: DiscoveryReport, env: EnvironmentInfo): string[] {
	const name = r.editor === "neovim" ? "Neovim" : "Vim";
	const lines = [`## ${name} keymaps`, ""];
	if (!r.ok) {
		lines.push(`**Discovery failed:** ${r.error ?? "unknown error"}`, "");
		lines.push(
			"The built-in reference still works. Check the error below, try **Safe** discovery in preferences, or run the editor manually to see if its configuration starts cleanly.",
			"",
		);
	} else {
		lines.push(
			`- Mode: ${r.mode === "config" ? "configuration loaded" : "safe (no user configuration)"}`,
		);
		lines.push(
			`- Mappings found: **${r.entries.length}** in ${r.durationMs} ms`,
		);
		for (const [status, count] of Object.entries(r.counts))
			lines.push(
				`  - ${STATUS_LABELS[status as keyof typeof STATUS_LABELS]}: ${count}`,
			);
		lines.push(`- Leader: ${leaderText(r.leader)}`);
		lines.push(`- Local leader: ${leaderText(r.localLeader)}`);
		if (r.lazy)
			lines.push(
				`- lazy.nvim: ${r.lazy.pluginCount} plugins (${r.lazy.loadedCount} loaded at startup${r.lazy.disabledCount ? `, ${r.lazy.disabledCount} disabled` : ""})`,
			);
		if (r.editor === "neovim") {
			if (r.lazyvim?.detected) {
				lines.push(
					`- LazyVim: **detected**${r.lazyvim.version ? ` (v${r.lazyvim.version})` : ""}`,
				);
				if (r.lazyvim.extras.length)
					lines.push(
						`- LazyVim extras: ${r.lazyvim.extras.map((e) => codeSpan(e.replace(/^lazyvim\.plugins\.extras\./, ""))).join(", ")}`,
					);
			} else {
				const hint = env.neovim?.config.lazyvimJson
					? " (lazyvim.json exists, but LazyVim was not loaded)"
					: "";
				lines.push(`- LazyVim: not detected${hint}`);
			}
		}
		lines.push("");
	}
	if (r.scriptErrors.length)
		lines.push(
			"**Script warnings**",
			"",
			...r.scriptErrors.map((e) => `- ${e.split("\n")[0]}`),
			"",
		);
	if (r.stderr) lines.push("**Editor output**", "", "```", r.stderr, "```", "");
	lines.push("**Limitations**", "", ...r.limitations.map((l) => `- ${l}`), "");
	return lines;
}

export function diagnosticsMarkdown(
	env: EnvironmentInfo | undefined,
	reports: DiscoveryReport[],
	settings: Settings,
	savedAt?: number,
): string {
	const lines = ["# Environment Diagnostics", ""];
	if (!env) return [...lines, "Detecting editors..."].join("\n");
	lines.push("## Editors", "");
	const nv = env.neovim;
	if (nv) {
		lines.push(
			`- **Neovim** ${nv.version ? `v${nv.version}` : "(version unknown)"} at ${codeSpan(nv.path)}${nv.foundVia === "preference" ? " (from preferences)" : ""}`,
		);
		if (nv.error) lines.push(`  - Error: ${nv.error}`);
		lines.push(
			`  - Configuration: ${codeSpan(nv.config.configDir)}${nv.config.exists ? "" : " (does not exist)"}${nv.config.appName !== "nvim" ? `, NVIM_APPNAME=${codeSpan(nv.config.appName)}` : ""}`,
		);
	} else lines.push("- **Neovim**: not found");
	const vim = env.vim;
	if (vim) {
		lines.push(
			`- **Vim** ${vim.version ? `v${vim.version}` : "(version unknown)"} at ${codeSpan(vim.path)}${vim.foundVia === "preference" ? " (from preferences)" : ""}`,
		);
		if (vim.error) lines.push(`  - Error: ${vim.error}`);
		lines.push(`  - vimrc: ${vim.vimrc ? codeSpan(vim.vimrc) : "none found"}`);
	} else lines.push("- **Vim**: not found");
	lines.push(
		`- Showing mappings for: **${env.active === "neovim" ? "Neovim" : env.active === "vim" ? "Vim" : "none (built-in reference only)"}**`,
	);
	lines.push(
		`- Runtime discovery: ${DISCOVERY_LABEL[settings.runtimeDiscovery]}`,
	);
	if (settings.leaderOverride !== undefined)
		lines.push(
			`- Leader display override: ${leaderText(settings.leaderOverride)}`,
		);
	if (savedAt)
		lines.push(`- Last discovery: ${new Date(savedAt).toLocaleString()}`);
	lines.push("");
	if (env.warnings.length)
		lines.push("**Warnings**", "", ...env.warnings.map((w) => `- ${w}`), "");
	if (settings.runtimeDiscovery === "off")
		lines.push(
			"Runtime discovery is turned off in preferences, so only the built-in reference is searched.",
			"",
		);
	else if (reports.length === 0)
		lines.push("No editor was available for runtime discovery.", "");
	for (const r of reports) lines.push(...reportSection(r, env));
	lines.push(
		"## Privacy",
		"",
		"Everything above stays on this machine. Vim Companion makes no network requests; in configuration mode it starts your editor headlessly, which runs your configuration's startup code.",
	);
	return lines.join("\n");
}
