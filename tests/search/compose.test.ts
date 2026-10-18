import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { compose } from "../../src/search/compose";

const top = (q: string) => compose(q)[0]?.entry.keys;
const all = (q: string) => compose(q).map((c) => c.entry.keys);

describe("operator and text-object composer", () => {
  const cases: Array<[string, string]> = [
    ["delete inside quotes", 'di"'],
    ["change inside parentheses", "ci("],
    ["select around braces", "va{"],
    ["copy inside brackets", "yi("],
    ["change current word", "ciw"],
    ["delete around word", "daw"],
    ["yank inner paragraph", "yip"],
    ["select inside single quotes", "vi'"],
    ["change inside backticks", "ci`"],
    ["delete inside square brackets", "di["],
    ["change inside curly braces", "ci{"],
    ["delete around tag", "dat"],
    ["change inside html tag", "cit"],
    ["select inside angle brackets", "vi<"],
    ["delete inside WORD", "diW"],
    ["change inner sentence", "cis"],
    ["uppercase inside quotes", 'gUi"'],
    ["lowercase word", "guiw"],
    ["indent inside braces", ">i{"],
    ["reindent paragraph", "=ip"],
    ["format paragraph", "gqip"],
    ["remove everything between parentheses", "di("],
    ["delete quotes including the quotes", 'da"'],
    ["clear string", 'di"'],
    ["change function arguments", "ci("],
  ];
  for (const [query, expected] of cases) {
    it(`"${query}" -> ${expected}`, () => assert.equal(top(query), expected));
  }

  it("offers alternatives for ambiguous 'brackets', parentheses first", () => {
    assert.deepEqual(all("delete inside brackets"), ["di(", "di[", "di{"]);
    const [a, b] = compose("delete inside brackets");
    assert.ok(a.confidence > b.confidence);
  });

  it("explains each component", () => {
    const [c] = compose("change inside parentheses");
    assert.deepEqual(
      c.entry.composed?.map((p) => p.keys),
      ["c", "i("],
    );
    assert.match(c.entry.composed?.[0].meaning ?? "", /change/);
  });

  it("refuses combinations outside the whitelist", () => {
    assert.deepEqual(all("indent word"), []);
    assert.deepEqual(all("format quotes"), []);
  });

  it("requires both an operator and a text object", () => {
    assert.deepEqual(all("delete line"), []);
    assert.deepEqual(all("inside quotes"), []);
    assert.deepEqual(all("quotes"), []);
  });

  it("lowers confidence for unexplained words and gives up on noise", () => {
    const clean = compose("delete inside quotes")[0].confidence;
    const noisy = compose("delete inside quotes on every other line")[0]?.confidence ?? 0;
    assert.ok(noisy < clean);
    assert.deepEqual(all("delete word from every file in my whole project tree now"), []);
  });

  it("never emits keys outside Vim's operator grammar", () => {
    const valid = /^(d|c|y|v|gU|gu|g~|>|<|=|gq)[ia][wWsp"'`([{<t]$/;
    const phrases = ["delete", "change", "copy", "select", "uppercase", "indent", "format"].flatMap((op) =>
      ["inside", "around", ""].flatMap((scope) => ["word", "quotes", "brackets", "braces", "tag", "paragraph", "sentence"].map((o) => `${op} ${scope} ${o}`)),
    );
    for (const p of phrases) for (const k of all(p)) assert.match(k, valid, `${p} -> ${k}`);
  });
});
