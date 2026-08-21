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
