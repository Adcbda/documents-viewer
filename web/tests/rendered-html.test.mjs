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
    (item) => item.id === "软件著作权技术信息确认单.pdf",
  );

  assert.deepEqual(document, {
    id: "软件著作权技术信息确认单.pdf",
    title: "软件著作权技术信息确认单",
    file: "软件著作权技术信息确认单.pdf",
    kind: "pdf",
    sourceFile: "软件著作权技术信息确认单.docx",
  });
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
