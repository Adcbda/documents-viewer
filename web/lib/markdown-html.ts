import { defaultSchema, type Options } from "rehype-sanitize";

const elementsWithInlineStyles = [
  "div",
  "span",
  "p",
  "img",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
] as const;

const attributes = { ...defaultSchema.attributes };

for (const tagName of elementsWithInlineStyles) {
  attributes[tagName] = [...(attributes[tagName] ?? []), "style"];
}

/**
 * GitHub-style HTML sanitization with inline layout styles for document content.
 * Scripts, event handlers, iframes, and unsafe URL protocols remain disallowed.
 */
export const markdownHtmlSanitizeSchema: Options = {
  ...defaultSchema,
  attributes,
};
