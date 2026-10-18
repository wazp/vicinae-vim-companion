import { Color, Icon } from "@vicinae/api";
import type { CommandEntry, EntryStatus } from "../types/commands";
import { MODE_LABELS, SOURCE_LABELS } from "../types/commands";

export function sourceLabel(e: CommandEntry): string {
	if (e.composed) return "Composed";
	if (e.status === "reference")
		return e.source === "neovim" ? "Neovim built-in" : "Vim built-in";
	return e.sourceName ?? SOURCE_LABELS[e.source];
}

export function modesLabel(e: CommandEntry): string {
	const labels = [...new Set(e.modes.map((m) => MODE_LABELS[m]))];
	return labels.length > 2
		? `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`
		: labels.join(", ");
}

/** Short mode letters for the accessory tag, e.g. "n x o". */
export function modesShort(e: CommandEntry): string {
	return [...new Set(e.modes)].join(" ");
}

export const STATUS_ICON: Record<
	EntryStatus,
	{ source: Icon; tintColor?: Color }
> = {
	reference: { source: Icon.Book },
	active: { source: Icon.CheckCircle, tintColor: Color.Green },
	"buffer-local": { source: Icon.Dot, tintColor: Color.Blue },
	declared: { source: Icon.Plug, tintColor: Color.Purple },
	conditional: { source: Icon.QuestionMarkCircle, tintColor: Color.Orange },
	overridden: { source: Icon.Warning, tintColor: Color.Yellow },
};

export function entryIcon(e: CommandEntry): {
	source: Icon;
	tintColor?: Color;
} {
	if (e.composed) return { source: Icon.Wand, tintColor: Color.Magenta };
	return STATUS_ICON[e.status];
}

/** Keys as shown in the list: symbolic keys plus the expanded form when they differ. */
export function keysLabel(e: CommandEntry): string {
	return e.keysDisplay ? `${e.keys}  →  ${e.keysDisplay}` : e.keys;
}
