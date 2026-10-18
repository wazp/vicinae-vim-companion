import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayKeys, expandLeader, leaderLabel, normalizeKeys, parseKeyQuery, splitKeys, templateToRegExp } from "../../src/utils/keys";

describe("key notation", () => {
  it("splits sequences into keys", () => {
    assert.deepEqual(splitKeys("<C-w>v"), ["<C-w>", "v"]);
    assert.deepEqual(splitKeys("<leader>ff"), ["<leader>", "f", "f"]);
    assert.deepEqual(splitKeys(" ff"), ["<Space>", "f", "f"]);
    assert.deepEqual(splitKeys("di("), ["d", "i", "("]);
    assert.deepEqual(splitKeys("f{char}"), ["f", "{char}"]);
  });

  it("normalizes equivalent notations", () => {
    assert.equal(normalizeKeys("<c-R>"), "<C-r>");
    assert.equal(normalizeKeys("<C-R>"), "<C-r>");
    assert.equal(normalizeKeys("<space>ff"), "<Space>ff");
    assert.equal(normalizeKeys(" ff"), "<Space>ff");
    assert.equal(normalizeKeys("<Leader>ff"), "<leader>ff");
    assert.equal(normalizeKeys("<CR>"), normalizeKeys("<Enter>"));
    assert.equal(normalizeKeys("<lt>"), "<");
  });

  it("parses typed modifier descriptions", () => {
    assert.equal(parseKeyQuery("ctrl-r"), "<C-r>");
    assert.equal(parseKeyQuery("Ctrl+W v"), "<C-w>v");
    assert.equal(parseKeyQuery("^R"), "<C-r>");
    assert.equal(parseKeyQuery("<c-o>"), "<C-o>");
    assert.equal(parseKeyQuery("delete line"), undefined);
    assert.equal(parseKeyQuery("^"), undefined);
  });

  it("expands leader keys", () => {
    assert.equal(expandLeader("<leader>ff", " "), " ff");
    assert.equal(expandLeader("<localleader>r", " ", ","), ",r");
    assert.equal(expandLeader("<leader>x"), "\\x");
  });

  it("renders keys for display without assuming Space", () => {
    assert.equal(displayKeys("<leader>ff", " "), "Space f f");
    assert.equal(displayKeys("<leader>ff", ","), ", f f");
    assert.equal(displayKeys("<leader>ff"), "Leader f f");
    assert.equal(displayKeys("<C-w>v"), "Ctrl-w v");
    assert.equal(leaderLabel(" "), "Space");
    assert.equal(leaderLabel("\\"), "\\");
    assert.equal(leaderLabel(undefined), undefined);
  });

  it("turns placeholders into matchers", () => {
    assert.ok(templateToRegExp("dt{char}")?.test("dt,"));
    assert.ok(!templateToRegExp("dt{char}")?.test("dt,,"));
    assert.ok(templateToRegExp("{count}|")?.test("80|"));
    assert.ok(templateToRegExp("m{a-z}")?.test("ma"));
    assert.ok(!templateToRegExp("m{a-z}")?.test("mA"));
    assert.equal(templateToRegExp("dd"), undefined);
  });
});
