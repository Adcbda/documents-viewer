import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkMath from "remark-math";

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

test("renders inline and block LaTeX with KaTeX after sanitizing raw HTML", () => {
  const markdown = [
    String.raw`e $ \underline{\text{Visual eBIOS (VeB) Manual}} $.`,
    "",
    "$$",
    String.raw`\int_0^1 x^2\,dx = \frac{1}{3}`,
    "$$",
    '<script>alert("unsafe")</script>',
  ].join("\n");

  const html = renderToStaticMarkup(createElement(
    ReactMarkdown,
    {
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypeRaw, [rehypeSanitize, markdownHtmlSanitizeSchema], rehypeKatex],
    },
    markdown,
  ));

  assert.match(html, /class="katex"/);
  assert.match(html, /class="katex-display"/);
  assert.match(html, /\\underline\{\\text\{Visual eBIOS \(VeB\) Manual\}\}/);
  assert.match(html, /class="mord underline"/);
  assert.doesNotMatch(html, /script|unsafe/);
});
