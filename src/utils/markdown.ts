/** Inline code that survives backticks inside the content (e.g. the `` ` `` mark command). */
export function codeSpan(text: string): string {
	const runs = text.match(/`+/g) ?? [];
	const fence = "`".repeat(Math.max(0, ...runs.map((r) => r.length)) + 1);
	const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
	return `${fence}${pad}${text}${pad}${fence}`;
}

/** Escape characters that would turn plain text into Markdown formatting. */
export function escapeMarkdown(text: string): string {
	return text.replace(/([\\*_[\]<>#|])/g, "\\$1");
}
