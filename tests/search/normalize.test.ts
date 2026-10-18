import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { editDistance, typoBudget } from "../../src/search/fuzzy";
import {
	normalizeText,
	queryTerms,
	stem,
	tokenize,
} from "../../src/search/normalize";
import { canonical, related } from "../../src/search/synonyms";

describe("normalization", () => {
	it("lowercases and strips diacritics", () => {
		assert.equal(normalizeText("  Ré-Indent  Fïle "), "re-indent file");
	});

	it("tokenizes on punctuation and keeps unicode letters", () => {
		assert.deepEqual(tokenize("délete: in-side (brackets)"), [
			"delete",
			"in",
			"side",
			"brackets",
		]);
	});

	it("stems inflections onto the same root", () => {
		assert.equal(stem("deleting"), stem("delete"));
		assert.equal(stem("deleted"), stem("delete"));
		assert.equal(stem("brackets"), stem("bracket"));
		assert.equal(stem("changes"), stem("change"));
		assert.equal(stem("copies"), stem("copy"));
		assert.equal(stem("mapping"), stem("map"));
		assert.equal(stem("indentation"), stem("indent"));
	});

	it("leaves short and -ss/-us words alone", () => {
		assert.equal(stem("gg"), "gg");
		assert.equal(stem("previous"), "previous");
		assert.equal(stem("class"), "class");
	});

	it("drops stopwords but never everything", () => {
		assert.deepEqual(queryTerms("how do I go to the end of the file"), [
			"go",
			"end",
			"fil",
		]);
		assert.deepEqual(queryTerms("the"), ["the"]);
	});
});

describe("synonyms", () => {
	const c = (w: string) => canonical(stem(w));

	it("maps true synonyms to one concept", () => {
		assert.equal(c("copy"), c("yank"));
		assert.equal(c("remove"), c("delete"));
		assert.equal(c("replace"), c("change"));
		assert.equal(c("find"), c("search"));
		assert.equal(c("folder"), c("directory"));
		assert.equal(c("beginning"), c("start"));
		assert.equal(c("back"), c("previous"));
		assert.equal(c("forward"), c("next"));
		assert.equal(c("parentheses"), c("parenthesis"));
	});

	it("keeps distinct Vim concepts distinct", () => {
		assert.notEqual(c("tab"), c("buffer"));
		assert.notEqual(c("buffer"), c("window"));
		assert.notEqual(c("paren"), c("brace"));
		assert.notEqual(c("bracket"), c("paren"));
		assert.notEqual(c("end"), c("bottom"));
	});

	it("relates ambiguous words with reduced weight", () => {
		const fromBracket = related(c("bracket"));
		const paren = fromBracket.find((r) => r.term === c("paren"));
		const brace = fromBracket.find((r) => r.term === c("brace"));
		assert.ok(paren && brace);
		assert.ok(paren.weight > brace.weight && paren.weight < 1);
		const tabToBuffer = related(c("tab")).find((r) => r.term === c("buffer"));
		assert.ok(tabToBuffer && tabToBuffer.weight < 0.5);
	});
});

describe("fuzzy matching", () => {
	it("computes edit distance with transpositions", () => {
		assert.equal(editDistance("delete", "delete"), 0);
		assert.equal(editDistance("delte", "delete"), 1);
		assert.equal(editDistance("chnage", "change"), 1);
		assert.equal(editDistance("kitten", "sitting"), 3);
	});

	it("stops early past the budget", () => {
		assert.equal(editDistance("abcdefgh", "zzzzzzzz", 2), 3);
	});

	it("tolerates no typos in short words", () => {
		assert.equal(typoBudget(3), 0);
		assert.equal(typoBudget(5), 1);
		assert.equal(typoBudget(10), 2);
	});
});
