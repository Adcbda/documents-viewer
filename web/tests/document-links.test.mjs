import assert from "node:assert/strict";
import test from "node:test";

import { getDocumentViewerUrl, resolveDocumentLink } from "../lib/document-links.ts";

const sourceFile = "迈迪杰PC管家运维管理云平台-源代码.md";
const document = (file, kind = "markdown") => ({ id: file, title: file, file, kind });
const documents = [
  document(sourceFile),
  document("guides/开始.md"),
  document("guides/next.md"),
  document("next.md"),
  document("reports/报告.pdf", "pdf"),
  document("guides/空 格+#?100%.md"),
  document("guides/literal%20name.md"),
];

test("opens the reported Chinese relative Markdown link in the viewer", () => {
  const result = resolveDocumentLink("客户端源码编排与核验说明.md", sourceFile, documents);
  assert.equal(result.document, documents[0]);
  assert.equal(result.href, getDocumentViewerUrl(sourceFile));
});

test("resolves encoded filenames once, including literal percent sequences", () => {
  assert.equal(resolveDocumentLink("说明.md", encodeURIComponent(sourceFile), documents).document, documents[0]);
  assert.equal(resolveDocumentLink("guides/开始.md", "literal%2520name.md", documents).document, documents[6]);
  const special = resolveDocumentLink("guides/开始.md", encodeURIComponent("空 格+#?100%.md"), documents);
  assert.equal(special.document, documents[5]);
  assert.equal(new URL(special.href, "https://example.test").searchParams.get("document"), documents[5].file);
});

test("resolves full relative paths without confusing same-named documents", () => {
  assert.equal(resolveDocumentLink("guides/开始.md", "./next.md", documents).document, documents[2]);
  assert.equal(resolveDocumentLink("guides/开始.md", "../next.md", documents).document, documents[3]);
  assert.equal(resolveDocumentLink("guides/nested/start.md", "../next.md", documents).document, documents[2]);
  assert.equal(resolveDocumentLink("unrelated/start.md", "next.md", documents).document, undefined);
});

test("keeps relative paths that escape the library from selecting root files", () => {
  for (const href of ["../../next.md", "../../library/next.md", "%2e%2e/%2e%2e/next.md"]) {
    assert.deepEqual(resolveDocumentLink("guides/开始.md", href, documents), { href, hash: "" });
  }
  assert.equal(resolveDocumentLink("start.md", "../next.md", documents).document, undefined);
});

test("supports root, library, and same-origin absolute document URLs", () => {
  const origin = "http://localhost:3000";
  for (const href of ["/next.md", "/library/next.md", `${origin}/next.md`, `${origin}/library/next.md`, "//localhost:3000/next.md"]) {
    assert.equal(resolveDocumentLink("guides/开始.md", href, documents, origin).document, documents[3]);
  }
});

test("opens indexed PDFs and preserves their fragment", () => {
  const result = resolveDocumentLink("guides/开始.md", "../reports/报告.pdf#page=3", documents);
  assert.equal(result.document, documents[4]);
  assert.equal(result.hash, "#page=3");
  assert.equal(result.href, getDocumentViewerUrl(documents[4].file, "#page=3"));
});

test("leaves external URLs, protocols, pure fragments, and empty links unchanged", () => {
  for (const href of [undefined, "", "#标题", "https://example.test/next.md", "//example.test/next.md", "http://localhost:4000/next.md", "mailto:hello@example.test", "tel:+123456", "data:text/plain,hello"]) {
    assert.deepEqual(resolveDocumentLink("guides/开始.md", href, documents, "http://localhost:3000"), { href, hash: "" });
  }
});

test("maps relative attachments to the library while retaining query and fragment", () => {
  assert.deepEqual(resolveDocumentLink("guides/开始.md", "images/图 1.png?download=1#preview", documents), {
    href: "/library/guides/images/%E5%9B%BE%201.png?download=1#preview",
    hash: "#preview",
  });
  assert.equal(resolveDocumentLink("guides/开始.md", "../表格.docx", documents).href, "/library/%E8%A1%A8%E6%A0%BC.docx");
  for (const href of ["/api/status", "/missing.md", "https://document-viewer.invalid/settings"]) {
    assert.equal(resolveDocumentLink("guides/开始.md", href, documents).href, href);
  }
});

test("viewer URLs round-trip reserved filename characters and preserve anchors", () => {
  const file = "folder/空 格+#?100%.md";
  const result = new URL(getDocumentViewerUrl(file, "#section-2"), "https://example.test");
  assert.equal(result.pathname, "/");
  assert.equal(result.searchParams.get("document"), file);
  assert.equal(result.hash, "#section-2");
  assert.equal(getDocumentViewerUrl("next.md", "section"), "/?document=next.md#section");
  const linked = resolveDocumentLink("guides/开始.md", "next.md?raw=1#%E6%A0%87%E9%A2%98", documents);
  assert.equal(linked.document, documents[2]);
  assert.equal(linked.hash, "#%E6%A0%87%E9%A2%98");
});

test("malformed encodings and URLs do not throw or select another document", () => {
  for (const href of ["bad%.md", "%E0%A4%A.md", "http://[invalid/next.md", "/%ZZ.md"]) {
    assert.deepEqual(resolveDocumentLink("guides/开始.md", href, documents), { href, hash: "" });
  }
});
