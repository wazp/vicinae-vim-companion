import { showToast, Toast } from "@vicinae/api";
import {
	refreshKeymaps,
	resetKeymapCache,
	summarize,
} from "./services/keymaps";
import { serviceOptions } from "./services/preferences";

export default async function RefreshKeymaps() {
	const options = serviceOptions();
	const toast = await showToast({
		style: Toast.Style.Animated,
		title: "Discovering keymaps...",
	});
	try {
		await resetKeymapCache(options);
		const state = await refreshKeymaps(options);
		const s = summarize(state);
		toast.style = s.ok ? Toast.Style.Success : Toast.Style.Failure;
		toast.title = s.title;
		toast.message = s.message;
	} catch (e) {
		toast.style = Toast.Style.Failure;
		toast.title = "Keymap discovery failed";
		toast.message = e instanceof Error ? e.message : String(e);
	}
}
