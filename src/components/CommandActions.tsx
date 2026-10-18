import {
	Action,
	ActionPanel,
	Icon,
	Keyboard,
	openExtensionPreferences,
} from "@vicinae/api";
import type { CommandEntry } from "../types/commands";
import { CommandDetail, explanationText } from "./CommandDetail";
import { DiagnosticsView } from "./DiagnosticsView";

export function CommandActions({
	entry,
	onRefresh,
	inDetail = false,
}: {
	entry: CommandEntry;
	onRefresh?: () => void;
	inDetail?: boolean;
}) {
	return (
		<>
			<ActionPanel.Section>
				{inDetail ? null : (
					<Action.Push
						title="View Details"
						icon={Icon.Eye}
						target={<CommandDetail entry={entry} onRefresh={onRefresh} />}
					/>
				)}
				<Action.CopyToClipboard
					title="Copy Keystrokes"
					content={entry.keys}
					shortcut={Keyboard.Shortcut.Common.Copy}
				/>
				{entry.keysDisplay ? (
					<Action.CopyToClipboard
						title="Copy Typed Keys"
						content={entry.keysDisplay}
					/>
				) : null}
				<Action.CopyToClipboard
					title="Copy Explanation"
					content={explanationText(entry)}
					shortcut={{ modifiers: ["ctrl", "shift"], key: "c" }}
				/>
				{entry.examples?.length ? (
					<Action.CopyToClipboard
						title="Copy Example"
						content={entry.examples[0]}
						shortcut={{ modifiers: ["ctrl", "shift"], key: "e" }}
					/>
				) : null}
			</ActionPanel.Section>
			<ActionPanel.Section>
				{onRefresh ? (
					<Action
						title="Refresh Keymaps"
						icon={Icon.ArrowClockwise}
						shortcut={Keyboard.Shortcut.Common.Refresh}
						onAction={onRefresh}
					/>
				) : null}
				<Action.Push
					title="Environment Diagnostics"
					icon={Icon.Bug}
					target={<DiagnosticsView />}
					shortcut={{ modifiers: ["ctrl", "shift"], key: "d" }}
				/>
				<Action
					title="Open Extension Preferences"
					icon={Icon.Cog}
					onAction={openExtensionPreferences}
				/>
			</ActionPanel.Section>
		</>
	);
}
