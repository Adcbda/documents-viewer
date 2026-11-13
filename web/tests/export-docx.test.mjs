import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { createMarkdownDocxBlob } from "../lib/export-docx.ts";

async function documentXml(markdown, options) {
  const blob = await createMarkdownDocxBlob(markdown, "example.md", "Example", options);
  const archive = await JSZip.loadAsync(await blob.arrayBuffer());
  return archive.file("word/document.xml").async("string");
}

test("applies the selected body size and scales headings with it", async () => {
  const xml = await documentXml("# 标题\n\n正文", { bodyFontSize: 14 });

  assert.match(xml, /<w:sz w:val="51"\/>/);
  assert.match(xml, /<w:sz w:val="28"\/>/);
});

test("supports Word Chinese size six at 7.5 points", async () => {
  const xml = await documentXml("六号正文", { bodyFontSize: 7.5 });

  assert.match(xml, /<w:sz w:val="15"\/>/);
});

test("preserves code block line breaks, blank lines, indentation, and tabs", async () => {
  const xml = await documentXml([
    "```ts",
    "const value = 1;",
    "",
    "  if (value) {",
    "\treturn value;",
    "}",
    "```",
  ].join("\r\n"));

  assert.equal((xml.match(/<w:br\/>/g) ?? []).length, 4);
  assert.match(xml, /<w:t xml:space="preserve"> {2}if \(value\) \{<\/w:t>/);
  assert.match(xml, /<w:tab\/>/);
  assert.match(xml, /<w:t xml:space="preserve">return value;<\/w:t>/);
});

function pageBreakCount(xml) {
  return (xml.match(/<w:br w:type="page"\/>/g) ?? []).length;
}

test("adds real Word page breaks for explicit pagination markers only when enabled", async () => {
  const markers = [
    '<div style="page-break-after: always;"></div>',
    "<div STYLE='color: red; PAGE-BREAK-BEFORE: ALWAYS !important'></div>",
    '<div style="break-before: page"></div>',
    '<br style="break-after: page" />',
    "<!-- pagebreak -->",
    "<!-- page-break -->",
    "\\newpage",
    "\\pagebreak",
  ];
  for (const marker of markers) {
    const markdown = `第一页\n\n${marker}\n\n第二页`;
    const enabled = await documentXml(markdown, { pageBreaks: true });
    assert.equal(pageBreakCount(enabled), 1, marker);
    assert.match(enabled, /第一页[\s\S]*<w:br w:type="page"\/>[\s\S]*第二页/);
    assert.equal(pageBreakCount(await documentXml(markdown)), 0, marker);
    assert.equal(pageBreakCount(await documentXml(markdown, { pageBreaks: false })), 0, marker);
  }
});

test("keeps text adjacent to a standalone HTML pagination marker", async () => {
  const xml = await documentXml('第一页\n<div style="page-break-after: always;"></div>\n**第二页**', { pageBreaks: true });
  assert.equal(pageBreakCount(xml), 1);
  assert.match(xml, /第一页[\s\S]*<w:br w:type="page"\/>[\s\S]*第二页/);
  assert.match(xml, /<w:b\/>/);
});

test("coalesces repeated pagination markers and ignores leading or trailing markers", async () => {
  const marker = '<div style="page-break-after: always;"></div>';
  const xml = await documentXml([marker, "第一页", marker, "<!-- pagebreak -->", "第二页", marker].join("\n\n"), { pageBreaks: true });
  assert.equal(pageBreakCount(xml), 1);
  assert.match(xml, /第一页[\s\S]*<w:br w:type="page"\/>[\s\S]*第二页/);
  assert.equal(pageBreakCount(await documentXml(`${marker}\n\n${marker}`, { pageBreaks: true })), 0);
});

test("does not treat examples, rules, setext headings, or ordinary HTML as page breaks", async () => {
  const markdown = [
    "```html", '<div style="page-break-after: always;"></div>', "<!-- pagebreak -->", "\\newpage", "```", "",
    "    <!-- pagebreak -->", "",
    "`<!-- pagebreak -->`", "",
    "标题", "---", "", "---", "", "***", "",
    '<div style="page-break-after: avoid;"></div>', "",
    '<div style="page-break-after: always;">内容</div>', "",
    "普通内容",
  ].join("\n");
  const xml = await documentXml(markdown, { pageBreaks: true });
  assert.equal(pageBreakCount(xml), 0);
  assert.match(xml, /&lt;!-- pagebreak --&gt;/);
  assert.match(xml, /<w:pBdr>/);
  assert.match(xml, /标题/);
});

test("supports literal custom marker lines without blank separators", async () => {
  const xml = await documentXml("第一页\r\n  ===分页===  \r\n**第二页**\r\n===分页===\r\n第三页", {
    pageBreaks: true, customPageBreakMarker: "===分页===",
  });
  assert.equal(pageBreakCount(xml), 2);
  assert.match(xml, /第一页[\s\S]*<w:br w:type="page"\/>[\s\S]*第二页[\s\S]*<w:br w:type="page"\/>[\s\S]*第三页/);
  assert.doesNotMatch(xml, /===分页===/);
});

test("matches custom regex punctuation literally and supports horizontal-rule markers", async () => {
  const marker = "[page].*+?^$(){}|";
  const xml = await documentXml(`第一页\n${marker}\n第二页\npage-anything`, { pageBreaks: true, customPageBreakMarker: marker });
  assert.equal(pageBreakCount(xml), 1);
  assert.match(xml, /page-anything/);
  assert.equal(pageBreakCount(await documentXml("第一页\n\n---\n\n第二页", { pageBreaks: true, customPageBreakMarker: "---" })), 1);
  assert.equal(pageBreakCount(await documentXml("第一页\n<!-- split -->\n第二页", { pageBreaks: true, customPageBreakMarker: "<!-- split -->" })), 1);
});

test("custom markers require pagination to be enabled and a nonempty single-line marker", async () => {
  const markdown = "第一页\n\n===分页===\n\n第二页";
  const disabled = await documentXml(markdown, { customPageBreakMarker: "===分页===" });
  assert.equal(pageBreakCount(disabled), 0);
  assert.match(disabled, /===分页===/);
  for (const marker of ["", "   ", "a\nb"]) {
    assert.equal(pageBreakCount(await documentXml(markdown, { pageBreaks: true, customPageBreakMarker: marker })), 0);
  }
});

test("custom markers ignore code examples and inline occurrences", async () => {
  const xml = await documentXml([
    "```", "===分页===", "```", "",
    "    ===分页===", "",
    "`", "===分页===", "`", "",
    "正文中 ===分页=== 不是分页", "", "最后一段",
  ].join("\n"), { pageBreaks: true, customPageBreakMarker: "===分页===" });
  assert.equal(pageBreakCount(xml), 0);
  assert.match(xml, /===分页===/);
});

test("inserts page breaks before tables without dropping their rows", async () => {
  const xml = await documentXml("第一页\n\n<!-- pagebreak -->\n\n| 标题 |\n| --- |\n| 内容 |", { pageBreaks: true });
  assert.equal(pageBreakCount(xml), 1);
  assert.match(xml, /第一页[\s\S]*<w:br w:type="page"\/>[\s\S]*<w:tbl>/);
  assert.match(xml, /标题/);
  assert.match(xml, /内容/);
});
