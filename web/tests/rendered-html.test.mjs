import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the document reading shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>文档阅览室 · 文档在线阅读与导出<\/title>/);
  assert.match(html, /文档阅览室/);
  assert.match(html, /正在整理文档版面/);
  assert.doesNotMatch(html, /codex-preview|Building your site|Your site is taking shape/i);
});

test("publishes the confirmation form as a PDF preview with its DOCX source", async () => {
  const libraryRoot = new URL("../public/library/", import.meta.url);
  const index = JSON.parse(await readFile(new URL("index.json", libraryRoot), "utf8"));
  const document = index.documents.find(
    (item) => item.kind === "pdf" && item.sourceFile,
  );

  assert.ok(document);
  assert.equal(document.kind, "pdf");
  assert.equal(document.title, document.id.slice(0, -4));
  assert.equal(document.file, document.id);
  assert.equal(document.sourceFile, `${document.title}.docx`);
  assert.ok((await stat(new URL(document.file, libraryRoot))).size > 0);
  assert.ok((await stat(new URL(document.sourceFile, libraryRoot))).size > 0);
});

test("includes embedded PDF viewing and fallback actions", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<object[^>]+className="pdf-viewer"/);
  assert.match(page, /type="application\/pdf"/);
  assert.match(page, /新窗口打开/);
  assert.match(page, /下载原始 DOCX/);
  assert.match(css, /\.pdf-viewer\s*\{/);
  assert.match(css, /\.pdf-fallback\s*\{/);
});

test("supports a persistent light and dark reading theme", async () => {
  const [page, layout, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /aria-label="切换白天或夜间模式"/);
  assert.match(page, /localStorage\.setItem\(THEME_STORAGE_KEY, nextTheme\)/);
  assert.match(layout, /prefers-color-scheme: dark/);
  assert.match(layout, /document\.documentElement\.dataset\.theme = theme/);
  assert.match(css, /html\[data-theme="dark"\]\s*\{/);
  assert.doesNotMatch(page, /theme-label/);
  assert.match(css, /\.theme-icon-light\s*\{\s*display:\s*block/);
  assert.match(css, /@media print/);
});

test("offers Markdown download, DOCX export, and print-ready PDF", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /aria-label="下载 Markdown"/);
  assert.match(page, /exportMarkdownBundle\(markdown, activeDocument\.file, activeDocument\.title\)/);
  assert.match(page, /aria-label="导出 DOCX"/);
  assert.match(page, /aria-label="选择 DOCX 正文字号"/);
  assert.match(page, /label: "六号", value: 7\.5/);
  assert.match(page, /\{ bodyFontSize \}/);
  assert.match(page, /aria-label="导出 PDF"/);
  assert.match(page, /window\.print\(\)/);
  assert.match(page, /data-markdown-document/);
  assert.match(css, /@page\s*\{\s*size:\s*A4/);
  assert.match(css, /break-inside:\s*avoid/);
  assert.match(css, /\.markdown-continuous\s*\{/);
  assert.doesNotMatch(page, /A4 分页预览|splitCodeBlockAcrossPages|PaginatedMarkdownPreview/);
  assert.doesNotMatch(css, /markdown-page|pagination-measure|code-(?:truncated|continued|has-continuation)/);
});

test("shows the Markdown source line count in the document footer", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

  assert.match(page, /countMarkdownLines\(markdown\)/);
  assert.match(page, /共 \{lineCount\.toLocaleString\("zh-CN"\)\} 行/);
});

test("renders sanitized HTML and LaTeX embedded in Markdown", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(page, /remarkPlugins=\{\[remarkGfm, remarkMath\]\}/);
  assert.match(page, /rehypePlugins=\{\[rehypeRaw, \[rehypeSanitize, markdownHtmlSanitizeSchema\], rehypeKatex\]\}/);
  assert.match(layout, /import "katex\/dist\/katex\.min\.css"/);
  assert.match(page, /style=\{width === undefined \? style : \{ width: imageWidthStyle\(width\), \.\.\.style \}\}/);
});
