import { showToast, Toast } from "@vicinae/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BUILTIN_COMMANDS } from "../data/vim";
import { SearchIndex } from "../search/search";
import { buildCatalog } from "../services/catalog";
import {
	type KeymapState,
	loadCachedKeymaps,
	refreshKeymaps,
	type ServiceOptions,
	summarize,
} from "../services/keymaps";
import type { CommandEntry } from "../types/commands";
import type { Settings } from "../types/settings";

let inFlight: Promise<KeymapState> | undefined;

/** One discovery at a time, shared by every view in this process. */
function refreshOnce(options: ServiceOptions): Promise<KeymapState> {
	inFlight ??= refreshKeymaps(options).finally(() => {
		inFlight = undefined;
	});
	return inFlight;
}

export interface UseKeymaps {
	state?: KeymapState;
	catalog: CommandEntry[];
	index: SearchIndex;
	/** True while a background discovery is running. */
	isRefreshing: boolean;
	/** True until the cache has been read (the built-in reference is usable meanwhile). */
	isLoadingCache: boolean;
	refresh: (opts?: { notify?: boolean }) => Promise<void>;
}

const builtinIndexCache = new Map<string, SearchIndex>();

export function useKeymaps(
	settings: Settings,
	options: ServiceOptions,
): UseKeymaps {
	const [state, setState] = useState<KeymapState>();
	const [isRefreshing, setRefreshing] = useState(false);
	const [isLoadingCache, setLoadingCache] = useState(true);
	const mounted = useRef(true);

	const refresh = useCallback(
		async ({ notify = false }: { notify?: boolean } = {}) => {
			setRefreshing(true);
			const toast = notify
				? await showToast({
						style: Toast.Style.Animated,
						title: "Discovering keymaps...",
					})
				: undefined;
			try {
				const next = await refreshOnce(options);
				if (!mounted.current) return;
				setState(next);
				const s = summarize(next);
				if (toast) {
					toast.style = s.ok ? Toast.Style.Success : Toast.Style.Failure;
					toast.title = s.title;
					toast.message = s.message;
				} else if (!s.ok) {
					await showToast({
						style: Toast.Style.Failure,
						title: s.title,
						message: s.message,
					});
				}
			} catch (e) {
				if (toast) {
					toast.style = Toast.Style.Failure;
					toast.title = "Keymap discovery failed";
					toast.message = e instanceof Error ? e.message : String(e);
				}
			} finally {
				if (mounted.current) setRefreshing(false);
			}
		},
		[options],
	);

	useEffect(() => {
		mounted.current = true;
		(async () => {
			const cached = await loadCachedKeymaps(options).catch(() => undefined);
			if (!mounted.current) return;
			if (cached) setState(cached.state);
			setLoadingCache(false);
			if (!cached || cached.stale) await refresh();
		})();
		return () => {
			mounted.current = false;
		};
	}, []);

	const catalog = useMemo(
		() =>
			buildCatalog({
				builtins: BUILTIN_COMMANDS,
				reports: state?.reports ?? [],
				settings,
				activeEditor: state?.environment.active,
			}),
		[state, settings],
	);
	const index = useMemo(() => {
		if (!state?.reports.length) {
			const key = String(settings.includeBuiltins);
			let idx = builtinIndexCache.get(key);
			if (!idx) {
				idx = new SearchIndex(catalog);
				builtinIndexCache.set(key, idx);
			}
			return idx;
		}
		return new SearchIndex(catalog);
	}, [catalog, state, settings.includeBuiltins]);

	return { state, catalog, index, isRefreshing, isLoadingCache, refresh };
}
