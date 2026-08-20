import assert from "node:assert/strict";
import test from "node:test";
import { collectMarkdownImageSources } from "../lib/export-markdown.ts";

test("collects inline and reference-style Markdown images without duplicates", () => {
  const markdown = [
    "![概览](软件截图/概览界面.png)",
    "![重复](软件截图/概览界面.png)",
    "![后台][admin]",
    "",
    "[admin]: 后台软件截图/工作台.png \"工作台\"",
    "[普通链接](附件.zip)",
  ].join("\n");

  assert.deepEqual(collectMarkdownImageSources(markdown), [
    "软件截图/概览界面.png",
    "后台软件截图/工作台.png",
  ]);
});

test("retains remote image references for callers to classify", () => {
  assert.deepEqual(
    collectMarkdownImageSources("![本地](./image.png)\n![远程](https://example.com/image.png)"),
    ["./image.png", "https://example.com/image.png"],
  );
});
