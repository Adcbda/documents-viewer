import assert from "node:assert/strict";
import test from "node:test";

import { countMarkdownLines } from "../lib/markdown-stats.ts";

test("counts Markdown lines across common newline formats", () => {
  assert.equal(countMarkdownLines(""), 0);
  assert.equal(countMarkdownLines("# 标题"), 1);
  assert.equal(countMarkdownLines("# 标题\n\n正文\n"), 3);
  assert.equal(countMarkdownLines("# 标题\r\n\r\n正文\r\n"), 3);
  assert.equal(countMarkdownLines("# 标题\r\r正文"), 3);
});
