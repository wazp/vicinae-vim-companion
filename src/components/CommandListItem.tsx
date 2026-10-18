import { ActionPanel, List } from "@vicinae/api";
import type { CommandEntry } from "../types/commands";
import { STATUS_LABELS } from "../types/commands";
import { CommandActions } from "./CommandActions";
import { entryIcon, modesLabel, modesShort, sourceLabel } from "./presentation";

export function CommandListItem({
	entry,
	onRefresh,
	showCategory = false,
}: {
	entry: CommandEntry;
	onRefresh?: () => void;
	showCategory?: boolean;
}) {
	const accessories: List.Item.Accessory[] = [
		{ tag: modesShort(entry), tooltip: `Modes: ${modesLabel(entry)}` },
		{
			text:
				showCategory && entry.status === "reference"
					? entry.category
					: sourceLabel(entry),
			tooltip: entry.context ?? STATUS_LABELS[entry.status],
		},
	];
	return (
		<List.Item
			id={entry.id}
			title={entry.title}
			subtitle={entry.keys}
			icon={{
				value: entryIcon(entry),
				tooltip: entry.composed
					? "Composed from operator + text object"
					: STATUS_LABELS[entry.status],
			}}
			accessories={accessories}
			actions={
				<ActionPanel>
					<CommandActions entry={entry} onRefresh={onRefresh} />
				</ActionPanel>
			}
		/>
	);
}
