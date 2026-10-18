import { execFile } from "node:child_process";

export interface ProcessResult {
	code: number | null;
	stdout: string;
	stderr: string;
	timedOut: boolean;
	/** Set when the process could not be started (e.g. ENOENT, EACCES). */
	spawnError?: string;
}

export interface ProcessOptions {
	timeoutMs?: number;
	maxBuffer?: number;
	env?: NodeJS.ProcessEnv;
	cwd?: string;
}

/**
 * Run an executable directly (never through a shell), with a timeout and a
 * cap on captured output. Never rejects: failures are reported in the result.
 */
export function runProcess(
	file: string,
	args: string[],
	options: ProcessOptions = {},
): Promise<ProcessResult> {
	return new Promise((resolve) => {
		let child: ReturnType<typeof execFile> | undefined;
		try {
			child = execFile(
				file,
				args,
				{
					shell: false,
					timeout: options.timeoutMs ?? 10_000,
					killSignal: "SIGKILL",
					maxBuffer: options.maxBuffer ?? 1024 * 1024,
					env: options.env ?? process.env,
					cwd: options.cwd,
					windowsHide: true,
					encoding: "utf8",
				},
				(error, stdout, stderr) => {
					const err = error as
						| (NodeJS.ErrnoException & {
								killed?: boolean;
								signal?: string;
								code?: number | string;
						  })
						| null;
					if (
						err &&
						typeof err.code === "string" &&
						err.code !== "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
					) {
						resolve({
							code: null,
							stdout: String(stdout ?? ""),
							stderr: String(stderr ?? ""),
							timedOut: false,
							spawnError: `${err.code}: ${err.message}`,
						});
						return;
					}
					const timedOut = Boolean(err?.killed && err.signal === "SIGKILL");
					resolve({
						code: err ? (typeof err.code === "number" ? err.code : null) : 0,
						stdout: String(stdout ?? ""),
						stderr: String(stderr ?? ""),
						timedOut,
					});
				},
			);
			child.stdin?.end();
		} catch (e) {
			resolve({
				code: null,
				stdout: "",
				stderr: "",
				timedOut: false,
				spawnError: e instanceof Error ? e.message : String(e),
			});
		}
	});
}

/** Keep the tail of noisy stderr output for diagnostics. */
export function excerpt(text: string, max = 1200): string {
	const trimmed = text.trim();
	return trimmed.length > max ? `...${trimmed.slice(-max)}` : trimmed;
}
