import type { CommandEntry } from "../types/commands";
import { normalizeKeys, parseKeyQuery, templateToRegExp } from "../utils/keys";
import { compose } from "./compose";
import { editDistance, typoBudget } from "./fuzzy";
import {
	normalizeText,
	queryTerms,
	STOPWORDS,
	stem,
	tokenize,
} from "./normalize";
import { canonical, related, synonymVocabulary } from "./synonyms";

export type MatchKind =
	| "exact-keys"
	| "keys"
	| "composed"
	| "title"
	| "alias"
	| "terms"
	| "partial";

export interface SearchResult {
	entry: CommandEntry;
	score: number;
	match: MatchKind;
}

export interface SearchOptions {
	limit?: number;
	/** The editor the user actually runs, used to demote entries for the other one. */
	editor?: "vim" | "neovim";
	/** Disable the operator/text-object composer (used by tests). */
	compose?: boolean;
}

interface Indexed {
	entry: CommandEntry;
	keysNorm: string;
	/** Leader-expanded keys, for runtime mappings. */
	keysAlt?: string;
	template?: RegExp;
	title: string[];
	/** Normalized title text, for "title starts with what was typed" matching. */
	titleText: string;
	aliases: string[][];
	keywords: Set<string>;
	description: Set<string>;
	category: Set<string>;
	extra: Set<string>;
	order: number;
}

interface Alt {
	term: string;
	weight: number;
}

const FIELD_WEIGHT = {
	keywords: 1,
	title: 1,
	alias: 0.95,
	extra: 0.7,
	category: 0.55,
	description: 0.45,
};

/** Canonical terms for a free-text field (title, alias, description). */
function textTerms(text: string): string[] {
	return [...new Set(queryTerms(text).map(canonical))];
}

/** Keywords are single concepts, so stopwords are kept. */
function keywordTerms(words: string[]): string[] {
	return words.flatMap((w) => tokenize(w).map((t) => canonical(stem(t))));
}

export class SearchIndex {
	private items: Indexed[] = [];
	private byKeys = new Map<string, Indexed[]>();
	/** Raw word -> stem, for prefix completion and typo correction. */
	private rawVocab = new Map<string, string>();
	private stems = new Set<string>();

	constructor(entries: CommandEntry[]) {
		entries.forEach((entry, order) => {
			this.add(entry, order);
		});
		for (const s of synonymVocabulary()) this.stems.add(s);
	}

	get size(): number {
		return this.items.length;
	}

	private learn(text: string) {
		for (const raw of tokenize(text)) {
			if (STOPWORDS.has(raw)) continue;
			const s = stem(raw);
			this.rawVocab.set(raw, s);
			this.stems.add(s);
		}
	}

	private add(entry: CommandEntry, order: number) {
		const keysNorm = normalizeKeys(entry.keys);
		const item: Indexed = {
			entry,
			keysNorm,
			keysAlt: entry.keysExpanded
				? normalizeKeys(entry.keysExpanded)
				: undefined,
			template: templateToRegExp(entry.keys),
			title: textTerms(entry.title),
			titleText: normalizeText(entry.title),
			aliases: entry.aliases.map(textTerms).filter((a) => a.length > 0),
			keywords: new Set(keywordTerms(entry.keywords)),
			description: new Set(textTerms(entry.description)),
			category: new Set(textTerms(entry.category)),
			extra: new Set(
				textTerms([entry.sourceName, entry.context].filter(Boolean).join(" ")),
			),
			order,
		};
		this.items.push(item);
		const list = this.byKeys.get(keysNorm) ?? [];
		list.push(item);
		this.byKeys.set(keysNorm, list);
		for (const text of [
			entry.title,
			entry.description,
			...entry.aliases,
			...entry.keywords,
			entry.sourceName ?? "",
		])
			this.learn(text);
	}

	/** Expand one query word into weighted canonical alternatives. */
	private expand(raw: string, isLast: boolean): Alt[] {
		const alts = new Map<string, number>();
		const put = (term: string, weight: number) => {
			if ((alts.get(term) ?? 0) < weight) alts.set(term, weight);
		};
		if (/^\d+$/.test(raw)) return [{ term: "number", weight: 0.8 }];
		const s = stem(raw);
		const known = this.stems.has(s);
		if (known) put(canonical(s), 1);
		else {
			// Typo correction against the vocabulary.
			const budget = typoBudget(s.length);
			if (budget > 0) {
				let best = budget + 1;
				const found: string[] = [];
				for (const v of this.stems) {
					if (Math.abs(v.length - s.length) > budget) continue;
					const d = editDistance(s, v, budget);
					if (d < best) {
						best = d;
						found.length = 0;
					}
					if (d === best && d <= budget) found.push(v);
				}
				for (const v of found) put(canonical(v), best === 1 ? 0.75 : 0.6);
			}
		}
		// Prefix completion while typing ("repl" -> replace).
		if ((isLast || !known) && raw.length >= 2) {
			let n = 0;
			for (const [word, wordStem] of this.rawVocab) {
				if (word.length > raw.length && word.startsWith(raw)) {
					// Prefer completions that are closer to what was typed: "ch" leans
					// toward "change" over "character".
					const closeness = 0.85 + 0.15 * (raw.length / word.length);
					put(canonical(wordStem), (known ? 0.6 : 0.85) * closeness);
					if (++n >= 40) break;
				}
			}
		}
		for (const [term, weight] of [...alts]) {
			for (const r of related(term)) put(r.term, weight * r.weight);
		}
		return [...alts].map(([term, weight]) => ({ term, weight }));
	}

	private keyScore(
		item: Indexed,
		q: string,
		qKeys: string | undefined,
		looksLikeKeys: boolean,
	): number {
		const keys = item.entry.keys;
		if (keys === q) return 2000;
		if (
			qKeys !== undefined &&
			(item.keysNorm === qKeys || item.keysAlt === qKeys)
		)
			return 1950;
		if (!looksLikeKeys) return 0;
		const nq = normalizeKeys(q);
		if (item.keysNorm === nq || item.keysAlt === nq) return 1950;
		const counted = /^[1-9]\d*(.+)$/.exec(q);
		if (
			counted &&
			(keys === counted[1] || item.keysNorm === normalizeKeys(counted[1]))
		)
			return 1700;
		if (
			q.length >= 2 &&
			!q.startsWith(":") &&
			(keys === `:${q}` || keys.startsWith(`:${q} `))
		)
			return 1300;
		if (qKeys === undefined && item.template?.test(q)) {
			// Prefer specific templates (dt{char}) over catch-alls (d{motion}).
			const literal = item.entry.keys.replace(/\{[^}]*\}/g, "").length;
			const generic =
				/\{(motion|command|commands|pattern|old|new|file|files|filter|address|dir|time|name|topic|option|lhs|marks|n|register)\}/.test(
					item.entry.keys,
				);
			return Math.min(1450, 1250 + 75 * literal - (generic ? 150 : 0));
		}
		if (keys.startsWith(`${q}{`)) return 1150;
		if (keys.toLowerCase() === q.toLowerCase())
			return q.length > 1 ? 1100 : 900;
		if (nq.length >= 1 && item.keysNorm.startsWith(nq) && !item.template)
			return 800 - 25 * (item.keysNorm.length - nq.length);
		if (item.keysAlt?.startsWith(nq) && nq.length >= 2)
			return 750 - 25 * (item.keysAlt.length - nq.length);
		return 0;
	}

	private phraseScore(
		phrase: string[],
		expanded: Alt[][],
	): { score: number; exact: boolean } {
		if (phrase.length === 0) return { score: 0, exact: false };
		const set = new Set(phrase);
		const covered = new Set<string>();
		let matched = 0;
		for (const alts of expanded) {
			let best = 0;
			let bestTerm: string | undefined;
			for (const a of alts) {
				if (set.has(a.term) && a.weight > best) {
					best = a.weight;
					bestTerm = a.term;
				}
			}
			matched += best;
			if (bestTerm) covered.add(bestTerm);
		}
		const covQ = matched / expanded.length;
		const covA = covered.size / set.size;
		return {
			score: covQ * (0.4 + 0.6 * covA),
			exact: covQ >= 0.999 && covA === 1,
		};
	}

	search(query: string, options: SearchOptions = {}): SearchResult[] {
		const q = query.trim();
		if (!q) return [];
		const limit = options.limit ?? 50;
		const words = tokenize(q);
		const meaningful = words.filter((w) => !STOPWORDS.has(w));
		const rawWords = meaningful.length > 0 ? meaningful : words;
		const expanded = rawWords.map((w, i) =>
			this.expand(w, i === rawWords.length - 1),
		);
		const qKeys = parseKeyQuery(q);
		const looksLikeKeys = !/\s/.test(q) && q.length <= 12;
		const qText = normalizeText(q);

		const results = new Map<Indexed | CommandEntry, SearchResult>();

		for (const item of this.items) {
			const kScore = this.keyScore(item, q, qKeys, looksLikeKeys);
			let tScore = 0;
			let match: MatchKind = "partial";
			if (expanded.length > 0 && qKeys === undefined) {
				let tokenSum = 0;
				let allMatched = true;
				for (const alts of expanded) {
					let best = 0;
					for (const a of alts) {
						let w = 0;
						if (item.keywords.has(a.term) || item.title.includes(a.term))
							w = FIELD_WEIGHT.keywords;
						else if (item.aliases.some((al) => al.includes(a.term)))
							w = FIELD_WEIGHT.alias;
						else if (item.extra.has(a.term)) w = FIELD_WEIGHT.extra;
						else if (item.category.has(a.term)) w = FIELD_WEIGHT.category;
						else if (item.description.has(a.term)) w = FIELD_WEIGHT.description;
						best = Math.max(best, w * a.weight);
					}
					tokenSum += best;
					if (best < 0.4) allMatched = false;
				}
				const tokenAvg = tokenSum / expanded.length;
				if (tokenAvg >= 0.3) {
					const title = this.phraseScore(item.title, expanded);
					let alias = { score: 0, exact: false };
					for (const al of item.aliases) {
						const s = this.phraseScore(al, expanded);
						if (s.exact && !alias.exact) alias = s;
						else if (s.exact === alias.exact && s.score > alias.score)
							alias = s;
					}
					tScore =
						300 * tokenAvg +
						(allMatched ? 120 : 0) +
						280 * alias.score +
						220 * title.score;
					if (title.exact) tScore += 320;
					else if (alias.exact) tScore += 260;
					// Launcher-style: the title begins with exactly what was typed.
					else if (qText.length >= 2 && item.titleText.startsWith(qText))
						tScore += 180;
					match = title.exact
						? "title"
						: alias.exact
							? "alias"
							: allMatched
								? "terms"
								: "partial";
				}
			}
			let score = Math.max(kScore, tScore);
			if (score <= 0) continue;
			if (kScore >= tScore) match = kScore >= 1900 ? "exact-keys" : "keys";
			if (score < 2000) score += this.contextBoost(item.entry, options);
			results.set(item, { entry: item.entry, score, match });
		}

		if (options.compose !== false) {
			for (const cand of compose(q)) {
				const existing = this.byKeys
					.get(normalizeKeys(cand.entry.keys))
					?.find(
						(i) => i.entry.source === "vim" && i.entry.status === "reference",
					);
				const composedScore = 1000 * cand.confidence;
				if (existing) {
					const prev = results.get(existing);
					const score = Math.max(prev?.score ?? 0, composedScore) + 50;
					if (!prev || prev.score < 1900)
						results.set(existing, {
							entry: existing.entry,
							score,
							match: "composed",
						});
				} else {
					results.set(cand.entry, {
						entry: cand.entry,
						score: composedScore - 50,
						match: "composed",
					});
				}
			}
		}

		const minScore = 200;
		const sorted = [...results.values()]
			.filter((r) => r.score >= minScore)
			.sort(
				(a, b) =>
					b.score - a.score || a.entry.keys.length - b.entry.keys.length,
			);
		return dedupe(sorted).slice(0, limit);
	}

	private contextBoost(entry: CommandEntry, options: SearchOptions): number {
		let boost = 0;
		switch (entry.status) {
			case "active":
				boost += 40;
				break;
			case "buffer-local":
				boost += 25;
				break;
			case "conditional":
				boost -= 15;
				break;
			case "declared":
				boost += 10;
				break;
			case "overridden":
				boost -= 120;
				break;
		}
		if (
			entry.status !== "reference" &&
			(entry.source === "custom" ||
				entry.source === "plugin" ||
				entry.source === "lazyvim")
		)
			boost += 20;
		if (
			options.editor === "vim" &&
			entry.source === "neovim" &&
			entry.status === "reference"
		)
			boost -= 80;
		return boost;
	}
}

/**
 * Drop exact duplicates (same source, keys and modes) while keeping genuinely
 * different entries, such as the same keys in different modes.
 */
export function dedupe(results: SearchResult[]): SearchResult[] {
	const seen = new Set<string>();
	const out: SearchResult[] = [];
	for (const r of results) {
		const e = r.entry;
		const key = `${e.status === "reference" ? "ref" : e.source}|${normalizeKeys(e.keys)}|${[...e.modes].sort().join("")}|${e.context ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(r);
	}
	return out;
}
