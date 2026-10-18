import { join } from "node:path";
import { environment, getPreferenceValues } from "@vicinae/api";
import { parseSettings, type Settings } from "../types/settings";
import type { ServiceOptions } from "./keymaps";

export function getSettings(): Settings {
	return parseSettings(getPreferenceValues<Record<string, unknown>>());
}

export function serviceOptions(
	settings: Settings = getSettings(),
): ServiceOptions {
	return { supportDir: join(environment.supportPath, "cache"), settings };
}
