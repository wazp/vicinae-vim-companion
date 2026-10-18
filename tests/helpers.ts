import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** A throwaway directory, removed by the returned cleanup function. */
export function tempDir(prefix = "vim-companion-test-"): {
	dir: string;
	cleanup: () => void;
} {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Write an executable shell script standing in for vim/nvim. */
export function fakeExecutable(
	dir: string,
	name: string,
	body: string,
): string {
	const p = join(dir, name);
	writeFileSync(p, `#!/bin/sh\n${body}\n`);
	chmodSync(p, 0o755);
	return p;
}
