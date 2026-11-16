import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import { markdownHtmlSanitizeSchema } from "../lib/markdown-html.ts";
import { getMarkdownHeadings, remarkDocumentPagination, rehypeDocumentPagination } from "../lib/markdown-pagination.ts";

function render(markdown, options = { enabled: true }) {
  return renderToStaticMarkup(createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath, [remarkDocumentPagination, options]],
    rehypePlugins: [rehypeRaw, [rehypeSanitize, markdownHtmlSanitizeSchema], rehypeKatex, [rehypeDocumentPagination, options]],
  }, markdown));
}

function pageCount(html) {
  return (html.match(/class="markdown-paper markdown-page"/g) ?? []).length;
}

test("creates numbered pages for built-in explicit separators", () => {
  for (const marker of [
    "<!-- pagebreak -->", "<!-- page-break -->", "\\newpage", "\\pagebreak",
    '<div style="page-break-after: always;"></div>', '<br style="break-before: page" />',
  ]) {
    const html = render(`# 第一页\n${marker}\n## 第二页`);
    assert.equal(pageCount(html), 2, marker);
    assert.match(html, /aria-label="第 1 页，共 2 页"/);
    assert.match(html, /第一页[\s\S]*第 1 页 \/ 共 2 页[\s\S]*第二页[\s\S]*第 2 页 \/ 共 2 页/);
    assert.doesNotMatch(html, /data-document-page-break|pagebreak|page-break-after/);
  }
});

test("matches custom separators literally on a complete line", () => {
  const marker = "[page].*+?^$(){}|";
  const html = render(`第一页\r\n  ${marker}  \r\n第二页\r\n正文中 ${marker} 不是分隔符`, { enabled: true, marker });
  assert.equal(pageCount(html), 2);
  assert.match(html, /正文中/);
  assert.equal(pageCount(render("第一段\n---\n第二段", { enabled: true, marker: "---" })), 2);
  assert.equal(pageCount(render("第一段\n<!-- split -->\n第二段", { enabled: true, marker: "<!-- split -->" })), 2);
  assert.equal(pageCount(render("第一段\n\n---\n\n第二段")), 1);
  for (const marker of ["", " ", "split\nnext"]) {
    assert.equal(pageCount(render("第一段\nsplit\n第二段", { enabled: true, marker })), 1);
  }
});

test("disabled pagination preserves continuous Markdown and custom text", () => {
  const markdown = "# 标题\n\n第一页\n===分页===\n第二页\n\n---\n\n末尾";
  const html = render(markdown, { enabled: false, marker: "===分页===" });
  const original = renderToStaticMarkup(createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm, remarkMath],
    rehypePlugins: [rehypeRaw, [rehypeSanitize, markdownHtmlSanitizeSchema], rehypeKatex],
  }, markdown));
  assert.equal(html, original);
  assert.equal(pageCount(html), 0);
});

test("does not split fenced, indented, inline or HTML code and math examples", () => {
  const markdown = [
    "正文", "", "```html", "===分页===", "<!-- pagebreak -->", "```", "",
    "    ===分页===", "", "`", "===分页===", "`", "",
    "<pre>", "===分页===", "</pre>", "", "<!--", "===分页===", "-->", "",
    "$$", "\\newpage", "$$", "", "末尾",
  ].join("\n");
  const html = render(markdown, { enabled: true, marker: "===分页===" });
  assert.equal(pageCount(html), 1);
  assert.match(html, /&lt;!-- pagebreak --&gt;/);
  assert.match(html, /<pre>/);
  assert.match(html, /===分页===/);
});

test("merges adjacent separators and skips leading, trailing and invisible pages", () => {
  const marker = "<!-- pagebreak -->";
  const html = render([marker, "<!-- ordinary comment -->", marker, "第一页", marker,
    '<script>alert("unsafe")</script>', marker, "第二页", marker, marker].join("\n\n"));
  assert.equal(pageCount(html), 2);
  assert.doesNotMatch(html, /script|unsafe|ordinary comment/);
  assert.equal(pageCount(render(`${marker}\n\n${marker}`)), 1);
});

test("keeps global reference links, reference images and footnotes across page boundaries", () => {
  const html = render([
    "第一页 [链接][shared]，脚注[^note]", "", "<!-- pagebreak -->", "",
    "第二页 ![图片][image]，仍是同一脚注[^note]", "", "<!-- pagebreak -->", "",
    "[shared]: https://example.com/reference", "[image]: example.png", "[^note]: 跨页脚注内容",
  ].join("\n"));
  assert.equal(pageCount(html), 2);
  assert.match(html, /href="https:\/\/example.com\/reference"/);
  assert.match(html, /src="example.png"/);
  assert.equal((html.match(/跨页脚注内容/g) ?? []).length, 1);
  assert.match(html, /第二页[\s\S]*跨页脚注内容[\s\S]*第 2 页 \/ 共 2 页/);
});

test("retains tables, task lists, sanitized HTML and KaTeX in page bodies", () => {
  const html = render([
    "| 标题 |", "| --- |", "| 内容 |", "", "<!-- pagebreak -->", "",
    "- [x] 已完成", "", '<div style="text-align: center;"><img src="image.png" width="18%" /></div>', "",
    "$x^2$", "", '<script>alert("unsafe")</script>',
  ].join("\n"));
  assert.equal(pageCount(html), 2);
  assert.match(html, /<table>/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /style="text-align:center"/);
  assert.match(html, /width="18%"/);
  assert.match(html, /class="katex"/);
  assert.doesNotMatch(html, /script|unsafe/);
});

test("headings follow rendered Markdown order and exclude code and custom separators", () => {
  const markdown = [
    "# **文档**标题", "", "```", "## 代码中的标题", "```", "",
    "## 分隔", "", "正文", "", "## 真正的标题", "", "Setext 标题", "---",
  ].join("\n");
  assert.deepEqual(getMarkdownHeadings(markdown, { enabled: true, marker: "## 分隔" }), [
    { level: 1, text: "文档标题" }, { level: 2, text: "真正的标题" }, { level: 2, text: "Setext 标题" },
  ]);
  assert.equal(getMarkdownHeadings(markdown).length, 4);
});
