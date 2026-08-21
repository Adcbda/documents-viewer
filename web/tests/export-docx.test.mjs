import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { createMarkdownDocxBlob } from "../lib/export-docx.ts";

async function documentXml(markdown) {
  const blob = await createMarkdownDocxBlob(markdown, "example.md", "Example");
  const archive = await JSZip.loadAsync(await blob.arrayBuffer());
  return archive.file("word/document.xml").async("string");
}

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
