import {
	Action,
	ActionPanel,
	Icon,
	List,
	openExtensionPreferences,
} from "@vicinae/api";
import { useMemo, useState } from "react";
import { CommandListItem } from "./components/CommandListItem";
import { DiagnosticsView } from "./components/DiagnosticsView";
import { sourceLabel } from "./components/presentation";
import { useKeymaps } from "./hooks/useKeymaps";
import { SearchIndex } from "./search/search";
import { getSettings, serviceOptions } from "./services/preferences";
import type { CommandEntry, EntryStatus, Mode } from "./types/commands";
import { MODE_LABELS, STATUS_LABELS } from "./types/commands";

function applyFilter(e: CommandEntry, filter: string): boolean {
	const [kind, value] = filter.split(":", 2);
	switch (kind) {
		case "status":
			return e.status === value;
		case "group":
			return sourceLabel(e) === value;
		case "mode":
			return e.modes.includes(value as Mode);
		case "editor":
			return e.editor === value;
		default:
			return true;
	}
}

export default function BrowseKeymaps() {
	const settings = useMemo(getSettings, []);
	const options = useMemo(() => serviceOptions(settings), [settings]);
	const { state, catalog, isRefreshing, isLoadingCache, refresh } = useKeymaps(
		settings,
		options,
	);
	const [searchText, setSearchText] = useState("");
	const [filter, setFilter] = useState("all");
	const onRefresh = () => refresh({ notify: true });

	const mappings = useMemo(
		() => catalog.filter((e) => e.category === "Keymaps"),
		[catalog],
	);
	const index = useMemo(() => new SearchIndex(mappings), [mappings]);
	const groups = useMemo(
		() =>
			[...new Set(mappings.map(sourceLabel))].sort((a, b) =>
				a.localeCompare(b),
			),
		[mappings],
	);
	const statuses = useMemo(
		() => [...new Set(mappings.map((e) => e.status))] as EntryStatus[],
		[mappings],
	);
	const modes = useMemo(
		() => [...new Set(mappings.flatMap((e) => e.modes))] as Mode[],
		[mappings],
	);
	const editors = useMemo(
		() =>
			[...new Set(mappings.map((e) => e.editor).filter(Boolean))] as string[],
		[mappings],
	);

	const visible = useMemo(() => {
		const base = searchText.trim()
			? index
					.search(searchText, { limit: settings.resultLimit * 3 })
					.map((r) => r.entry)
			: mappings;
		return base.filter((e) => applyFilter(e, filter));
	}, [index, mappings, searchText, filter, settings.resultLimit]);

	const discoveryOff = settings.runtimeDiscovery === "off";
	const failed = state?.reports.filter((r) => !r.ok) ?? [];
	const emptyTitle = discoveryOff
		? "Runtime discovery is off"
		: isRefreshing || isLoadingCache
			? "Discovering keymaps..."
			: failed.length
				? "Keymap discovery failed"
				: !state?.environment.active
					? "No Vim or Neovim installation found"
					: mappings.length === 0
						? "No mappings were discovered"
						: `No mappings match "${searchText.trim()}"`;
	const emptyDescription = discoveryOff
		? "Enable it in the extension preferences to browse your own mappings."
		: failed.length
			? (failed[0].error ?? "See Environment Diagnostics for details.")
			: !state?.environment.active
				? "Set the executable path in preferences if your editor is installed somewhere unusual."
				: "Try another filter or search term.";

	return (
		<List
			filtering={false}
			searchText={searchText}
			onSearchTextChange={setSearchText}
			isLoading={isRefreshing || isLoadingCache}
			searchBarPlaceholder="Search your mappings..."
			navigationTitle="Browse Keymaps"
			searchBarAccessory={
				<List.Dropdown
					tooltip="Filter mappings"
					value={filter}
					onChange={setFilter}
				>
					<List.Dropdown.Item
						title={`All mappings (${mappings.length})`}
						value="all"
					/>
					<List.Dropdown.Section title="Status">
						{statuses.map((s) => (
							<List.Dropdown.Item
								key={s}
								title={STATUS_LABELS[s]}
								value={`status:${s}`}
							/>
						))}
					</List.Dropdown.Section>
					<List.Dropdown.Section title="Source / plugin">
						{groups.map((g) => (
							<List.Dropdown.Item key={g} title={g} value={`group:${g}`} />
						))}
					</List.Dropdown.Section>
					<List.Dropdown.Section title="Mode">
						{modes.map((m) => (
							<List.Dropdown.Item
								key={m}
								title={`${MODE_LABELS[m]} (${m})`}
								value={`mode:${m}`}
							/>
						))}
					</List.Dropdown.Section>
					{editors.length > 1 ? (
						<List.Dropdown.Section title="Editor">
							{editors.map((ed) => (
								<List.Dropdown.Item
									key={ed}
									title={ed === "neovim" ? "Neovim" : "Vim"}
									value={`editor:${ed}`}
								/>
							))}
						</List.Dropdown.Section>
					) : null}
				</List.Dropdown>
			}
		>
			{visible.length === 0 ? (
				<List.EmptyView
					icon={discoveryOff ? Icon.Cog : Icon.Keyboard}
					title={emptyTitle}
					description={emptyDescription}
					actions={
						<ActionPanel>
							<Action
								title="Refresh Keymaps"
								icon={Icon.ArrowClockwise}
								onAction={onRefresh}
							/>
							<Action.Push
								title="Environment Diagnostics"
								icon={Icon.Bug}
								target={<DiagnosticsView />}
							/>
							<Action
								title="Open Extension Preferences"
								icon={Icon.Cog}
								onAction={openExtensionPreferences}
							/>
						</ActionPanel>
					}
				/>
			) : searchText.trim() ? (
				<List.Section title="Results" subtitle={`${visible.length}`}>
					{visible.slice(0, settings.resultLimit).map((e) => (
						<CommandListItem key={e.id} entry={e} onRefresh={onRefresh} />
					))}
				</List.Section>
			) : (
				groups.map((g) => {
					const items = visible.filter((e) => sourceLabel(e) === g);
					if (items.length === 0) return null;
					return (
						<List.Section key={g} title={g} subtitle={`${items.length}`}>
							{items.map((e) => (
								<CommandListItem key={e.id} entry={e} onRefresh={onRefresh} />
							))}
						</List.Section>
					);
				})
			)}
		</List>
	);
}
