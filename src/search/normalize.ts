/** Text normalization for the search index and queries. */

/** Words that carry no intent in queries such as "how do I go to the end of the file". */
export const STOPWORDS = new Set([
	"a",
	"an",
	"the",
	"to",
	"of",
	"on",
	"at",
	"for",
	"my",
	"me",
	"i",
	"how",
	"do",
	"does",
	"can",
	"with",
	"by",
	"from",
	"is",
	"it",
	"its",
	"this",
	"that",
	"and",
	"or",
	"vim",
	"nvim",
	"neovim",
	"please",
	"want",
	"way",
	"using",
	"into",
	"onto",
	"what",
	"which",
	"key",
	"keys",
	"shortcut",
	"in",
]);

/** Lowercase, strip diacritics (é -> e), collapse whitespace. */
export function normalizeText(input: string): string {
	return input
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}

/** Split into alphanumeric word tokens. Keeps tokens like "g" and "0". */
export function tokenize(input: string): string[] {
	return normalizeText(input)
		.split(/[^\p{L}\p{N}]+/u)
		.filter(Boolean);
}

/**
 * Deliberately light suffix stripping so "deleting", "deleted" and "delete"
 * meet, and "brackets" meets "bracket". Not a full Porter stemmer: we want
 * predictable behavior on a small, technical vocabulary.
 */
export function stem(word: string): string {
	if (word.length <= 3) return word;
	const rules: Array<[RegExp, string]> = [
		[/ies$/, "y"],
		[/ations?$/, ""],
		[/ing$/, ""],
		[/ed$/, ""],
		[/es$/, ""],
		[/([^su])s$/, "$1"],
	];
	let w = word;
	for (const [re, rep] of rules) {
		const next = w.replace(re, rep);
		if (next !== w && next.length >= 3) {
			w = next;
			break;
		}
	}
	if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
	// Doubled consonant left by -ing/-ed: "mapping" -> "mapp" -> "map".
	if (w.length > 3 && /([bdgmnprt])\1$/.test(w) && w !== word)
		w = w.slice(0, -1);
	return w;
}

/** Tokenize, drop stopwords (unless that would drop everything), and stem. */
export function queryTerms(input: string, stopwords = STOPWORDS): string[] {
	const tokens = tokenize(input);
	const kept = tokens.filter((t) => !stopwords.has(t));
	return (kept.length > 0 ? kept : tokens).map(stem);
}
