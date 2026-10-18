import {
	Action,
	ActionPanel,
	Detail,
	Icon,
	Keyboard,
	openExtensionPreferences,
} from "@vicinae/api";
import { useMemo } from "react";
import { useKeymaps } from "../hooks/useKeymaps";
import { diagnosticsMarkdown } from "../services/diagnostics";
import { getSettings, serviceOptions } from "../services/preferences";

export function DiagnosticsView() {
	const settings = useMemo(getSettings, []);
	const options = useMemo(() => serviceOptions(settings), [settings]);
	const { state, isRefreshing, isLoadingCache, refresh } = useKeymaps(
		settings,
		options,
	);
	const markdown = diagnosticsMarkdown(
		state?.environment,
		state?.reports ?? [],
		settings,
		state?.savedAt,
	);
	const busy = isRefreshing || isLoadingCache;
	return (
		<Detail
			navigationTitle="Environment Diagnostics"
			markdown={
				busy && !state
					? "# Environment Diagnostics\n\nDetecting editors and discovering keymaps..."
					: markdown
			}
			actions={
				<ActionPanel>
					<Action
						title="Refresh Keymaps"
						icon={Icon.ArrowClockwise}
						shortcut={Keyboard.Shortcut.Common.Refresh}
						onAction={() => refresh({ notify: true })}
					/>
					<Action.CopyToClipboard title="Copy Report" content={markdown} />
					<Action
						title="Open Extension Preferences"
						icon={Icon.Cog}
						onAction={openExtensionPreferences}
					/>
				</ActionPanel>
			}
		/>
	);
}
