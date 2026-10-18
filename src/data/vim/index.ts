import type { CommandEntry } from "../../types/commands";
import { editing, insertMode, operators } from "./editing";
import { motions, scrolling } from "./motions";
import {
	commandLine,
	completion,
	files,
	folding,
	indentFormat,
	macros,
	misc,
	neovimDefaults,
	repetition,
	spelling,
	terminal,
} from "./other";
import { marks, registers, undoRedo } from "./registers";
import { quickfix, searchReplace } from "./search";
import { textObjectCombos, textObjects } from "./text-objects";
import { visual } from "./visual";
import { buffers, tabs, windows } from "./windows";

/** The curated offline reference. Order here is the browse order when the search is empty. */
export const BUILTIN_COMMANDS: CommandEntry[] = [
	...motions,
	...scrolling,
	...textObjects,
	...operators,
	...textObjectCombos,
	...editing,
	...insertMode,
	...visual,
	...searchReplace,
	...registers,
	...undoRedo,
	...marks,
	...buffers,
	...windows,
	...tabs,
	...macros,
	...folding,
	...indentFormat,
	...commandLine,
	...files,
	...completion,
	...spelling,
	...repetition,
	...quickfix,
	...neovimDefaults,
	...terminal,
	...misc,
];
