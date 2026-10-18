import { ActionPanel, Detail } from "@vicinae/api";
import type { CommandEntry } from "../types/commands";
import { MODE_LABELS, STATUS_LABELS } from "../types/commands";
import { codeSpan, escapeMarkdown } from "../utils/markdown";
import { CommandActions } from "./CommandActions";
import { sourceLabel } from "./presentation";

export function entryMarkdown(e: CommandEntry): string {
	const lines: string[] = [`# ${escapeMarkdown(e.title)}`, ""];
	lines.push(
		`## ${codeSpan(e.keys)}${e.keysDisplay ? `  →  ${codeSpan(e.keysDisplay)}` : ""}`,
		"",
	);
	lines.push(escapeMarkdown(e.description), "");
	if (e.composed?.length) {
		lines.push("### How it is built", "");
		for (const p of e.composed)
			lines.push(`- ${codeSpan(p.keys)}: ${escapeMarkdown(p.meaning)}`);
		lines.push("", "Generated from Vim's operator + text-object grammar.", "");
	}
	if (e.examples?.length) {
		lines.push("### Examples", "");
		for (const ex of e.examples) lines.push(`- ${escapeMarkdown(ex)}`);
		lines.push("");
	}
	if (e.notes) lines.push("### Notes", "", escapeMarkdown(e.notes), "");
	lines.push("### Availability", "");
	lines.push(
		`- ${STATUS_LABELS[e.status]}${e.status === "reference" ? ": documented built-in behavior, not read from your editor" : ""}`,
	);
	if (e.availabilityReason)
		lines.push(`- ${escapeMarkdown(e.availabilityReason)}`);
	if (e.context) lines.push(`- ${escapeMarkdown(e.context)}`);
	if (e.status === "conditional")
		lines.push(
			"- This mapping only exists in some buffers, so it may not work everywhere.",
		);
	if (e.status === "declared")
		lines.push(
			"- Declared by a plugin spec; it was not observed as a mapping in the inspected session.",
		);
	if (e.status === "overridden")
		lines.push(
			"- Your configuration remaps these keys, so the built-in behavior described here does not apply in that mode.",
		);
	return lines.join("\n");
}

export function explanationText(e: CommandEntry): string {
	const parts = [
		`${e.keys}${e.keysDisplay ? ` (${e.keysDisplay})` : ""}: ${e.title}`,
		e.description,
	];
	if (e.composed)
		parts.push(e.composed.map((p) => `${p.keys} = ${p.meaning}`).join("\n"));
	if (e.notes) parts.push(e.notes);
	return parts.join("\n\n");
}

export function CommandDetail({
	entry,
	onRefresh,
}: {
	entry: CommandEntry;
	onRefresh?: () => void;
}) {
	return (
		<Detail
			navigationTitle={entry.title}
			markdown={entryMarkdown(entry)}
			metadata={
				<Detail.Metadata>
					<Detail.Metadata.Label title="Keys" text={entry.keys} />
					{entry.keysDisplay ? (
						<Detail.Metadata.Label title="Typed as" text={entry.keysDisplay} />
					) : null}
					<Detail.Metadata.TagList title="Modes">
						{[...new Set(entry.modes.map((m) => MODE_LABELS[m]))].map((m) => (
							<Detail.Metadata.TagList.Item key={m} text={m} />
						))}
					</Detail.Metadata.TagList>
					<Detail.Metadata.Label title="Source" text={sourceLabel(entry)} />
					<Detail.Metadata.Label title="Category" text={entry.category} />
					<Detail.Metadata.Label
						title="Status"
						text={STATUS_LABELS[entry.status]}
					/>
					{entry.rhs ? (
						<Detail.Metadata.Label title="Runs" text={entry.rhs} />
					) : null}
					{entry.editor ? (
						<Detail.Metadata.Label
							title="Discovered in"
							text={entry.editor === "neovim" ? "Neovim" : "Vim"}
						/>
					) : null}
				</Detail.Metadata>
			}
			actions={
				<ActionPanel>
					<CommandActions entry={entry} onRefresh={onRefresh} inDetail />
				</ActionPanel>
			}
		/>
	);
}
