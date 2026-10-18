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
import { useKeymaps } from "./hooks/useKeymaps";
import { getSettings, serviceOptions } from "./services/preferences";
import type { Category, CommandEntry } from "./types/commands";

type Filter = "all" | "reference" | "keymaps" | `category:${string}`;

function matchesFilter(e: CommandEntry, filter: Filter): boolean {
	if (filter === "all") return true;
	if (filter === "reference")
		return (
			e.status === "reference" ||
			e.status === "overridden" ||
			(e.category !== "Keymaps" && e.status === "active")
		);
	if (filter === "keymaps") return e.category === "Keymaps";
	return e.category === filter.slice("category:".length);
}

export default function SearchCommands() {
	const settings = useMemo(getSettings, []);
	const options = useMemo(() => serviceOptions(settings), [settings]);
	const { state, catalog, index, isRefreshing, refresh } = useKeymaps(
		settings,
		options,
	);
	const [searchText, setSearchText] = useState("");
	const [filter, setFilter] = useState<Filter>("all");
	const onRefresh = () => refresh({ notify: true });

	const categories = useMemo(() => {
		const order: Category[] = [];
		for (const e of catalog)
			if (!order.includes(e.category)) order.push(e.category);
		return order;
	}, [catalog]);

	const results = useMemo(() => {
		if (!searchText.trim()) return undefined;
		return index
			.search(searchText, {
				limit: settings.resultLimit * 3,
				editor: state?.environment.active,
			})
			.filter((r) => matchesFilter(r.entry, filter))
			.slice(0, settings.resultLimit);
	}, [index, searchText, filter, settings.resultLimit, state]);

	const runtimeCount = catalog.filter((e) => e.category === "Keymaps").length;
	const failed = state?.reports.filter((r) => !r.ok) ?? [];

	return (
		<List
			filtering={false}
			searchText={searchText}
			onSearchTextChange={setSearchText}
			isLoading={isRefreshing}
			searchBarPlaceholder="Describe what you want to do, or type keys..."
			navigationTitle="Vim Companion"
			searchBarAccessory={
				<List.Dropdown
					tooltip="Filter"
					value={filter}
					onChange={(v) => setFilter(v as Filter)}
				>
					<List.Dropdown.Section title="Sources">
						<List.Dropdown.Item
							title="Everything"
							value="all"
							icon={Icon.MagnifyingGlass}
						/>
						<List.Dropdown.Item
							title="Built-in reference"
							value="reference"
							icon={Icon.Book}
						/>
						<List.Dropdown.Item
							title={`My keymaps${runtimeCount ? ` (${runtimeCount})` : ""}`}
							value="keymaps"
							icon={Icon.Keyboard}
						/>
					</List.Dropdown.Section>
					<List.Dropdown.Section title="Categories">
						{categories
							.filter((c) => c !== "Keymaps")
							.map((c) => (
								<List.Dropdown.Item key={c} title={c} value={`category:${c}`} />
							))}
					</List.Dropdown.Section>
				</List.Dropdown>
			}
		>
			{results ? (
				results.length === 0 ? (
					<List.EmptyView
						icon={Icon.MagnifyingGlass}
						title={`Nothing matches "${searchText.trim()}"`}
						description={
							filter !== "all"
								? "Try the Everything filter, or describe the action differently (e.g. 'delete inside quotes', 'go to definition')."
								: "Try describing the action differently, e.g. 'change word', 'split window', or type the keys themselves."
						}
						actions={
							<ActionPanel>
								<Action
									title="Clear Search"
									icon={Icon.XMarkCircle}
									onAction={() => setSearchText("")}
								/>
								<Action.Push
									title="Environment Diagnostics"
									icon={Icon.Bug}
									target={<DiagnosticsView />}
								/>
							</ActionPanel>
						}
					/>
				) : (
					<List.Section title="Results" subtitle={`${results.length}`}>
						{results.map((r) => (
							<CommandListItem
								key={r.entry.id}
								entry={r.entry}
								onRefresh={onRefresh}
							/>
						))}
					</List.Section>
				)
			) : (
				<>
					{failed.length > 0 && filter !== "reference" ? (
						<List.Section title="Keymap discovery">
							<List.Item
								title={`${failed.map((r) => (r.editor === "neovim" ? "Neovim" : "Vim")).join(" and ")} keymap discovery failed`}
								subtitle="The built-in reference still works"
								icon={Icon.Warning}
								actions={
									<ActionPanel>
										<Action.Push
											title="Environment Diagnostics"
											icon={Icon.Bug}
											target={<DiagnosticsView />}
										/>
										<Action
											title="Retry Discovery"
											icon={Icon.ArrowClockwise}
											onAction={onRefresh}
										/>
										<Action
											title="Open Extension Preferences"
											icon={Icon.Cog}
											onAction={openExtensionPreferences}
										/>
									</ActionPanel>
								}
							/>
						</List.Section>
					) : null}
					{categories
						.filter((c) =>
							matchesFilter(
								{
									category: c,
									status: c === "Keymaps" ? "active" : "reference",
								} as CommandEntry,
								filter,
							),
						)
						.map((c) => {
							const items = catalog.filter(
								(e) => e.category === c && matchesFilter(e, filter),
							);
							return (
								<List.Section
									key={c}
									title={c === "Keymaps" ? "My keymaps" : c}
									subtitle={`${items.length}`}
								>
									{items.map((e) => (
										<CommandListItem
											key={e.id}
											entry={e}
											onRefresh={onRefresh}
										/>
									))}
								</List.Section>
							);
						})}
				</>
			)}
		</List>
	);
}
