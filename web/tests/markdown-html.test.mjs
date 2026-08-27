import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

import { markdownHtmlSanitizeSchema } from "../lib/markdown-html.ts";

test("allows document layout styles while retaining the safe HTML schema", () => {
  assert.ok(markdownHtmlSanitizeSchema.tagNames.includes("div"));
  assert.ok(markdownHtmlSanitizeSchema.tagNames.includes("img"));
  assert.ok(markdownHtmlSanitizeSchema.attributes.div.includes("style"));
  assert.ok(markdownHtmlSanitizeSchema.attributes.img.includes("style"));
  assert.ok(markdownHtmlSanitizeSchema.attributes["*"].includes("width"));
  assert.ok(markdownHtmlSanitizeSchema.strip.includes("script"));
});

test("parses the supported centered HTML image and removes scripts", () => {
  const markdown = [
    '<div style="text-align: center;"><img src="imgs/example.jpg" alt="Image" width="18%" /></div>',
    '<script>alert("unsafe")</script>',
  ].join("\n");

  const html = renderToStaticMarkup(createElement(
    ReactMarkdown,
    { rehypePlugins: [rehypeRaw, [rehypeSanitize, markdownHtmlSanitizeSchema]] },
    markdown,
  ));

  assert.match(html, /<div style="text-align:center">/);
  assert.match(html, /<img src="imgs\/example\.jpg" alt="Image" width="18%"/);
  assert.doesNotMatch(html, /script|unsafe/);
});
