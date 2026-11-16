import type { Element, ElementContent, Root as HtmlRoot, RootContent as HtmlContent } from "hast";
import type { Root as MarkdownRoot } from "mdast";
import { unified, type Plugin } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkParse from "remark-parse";

type MarkdownNode = { type: string; value?: unknown; children?: MarkdownNode[]; position?: { start: { offset?: number }; end: { offset?: number } } };
export type PaginationOptions = { enabled?: boolean; marker?: string };

export const PAGE_BREAK_MARKER = "<!-- pagebreak -->";

function isPageBreakMarker(value: string) {
  if (/^<!--\s*page[\s-]*break\s*-->$/i.test(value) || /^\\(?:newpage|pagebreak)$/.test(value)) return true;

  // Only empty elements are separators; styled elements containing content stay intact.
  const element = /^<(div|p|span|section)\b([^<>]*?)(?:\/\s*>|>\s*<\/\1\s*>)$/i.exec(value)
    ?? /^<(br|hr)\b([^<>]*?)\/?\s*>$/i.exec(value);
  if (!element) return false;
  const style = /(?:^|\s)style\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(element[2]);
  const declarations = style?.[1] ?? style?.[2] ?? style?.[3] ?? "";
  return /(?:^|;)\s*(?:page-break-(?:before|after)\s*:\s*always|break-(?:before|after)\s*:\s*(?:page|always))\s*(?:!important\s*)?(?:;|$)/i.test(declarations);
}

export function normalizePageBreaks(markdown: string, tree: MarkdownNode, customMarker?: string) {
  const custom = customMarker?.trim();
  const protectedRanges: { start: number; end: number }[] = [];
  const collectProtectedRanges = (node: MarkdownNode) => {
    const position = node.position;
    const rawHtml = node.type === "html" ? String(node.value ?? "").trim() : "";
    if (node.type === "code" || node.type === "inlineCode" || node.type === "math"
      || /^<(?:pre|script|style|textarea)\b/i.test(rawHtml)
      || (rawHtml.startsWith("<!--") && !isPageBreakMarker(rawHtml) && rawHtml !== custom)) {
      if (position?.start.offset !== undefined && position.end.offset !== undefined) {
        protectedRanges.push({ start: position.start.offset, end: position.end.offset });
      }
      return;
    }
    for (const child of node.children ?? []) collectProtectedRanges(child);
  };
  collectProtectedRanges(tree);

  // Match original lines literally, before Markdown unescaping or setext parsing.
  // Reparse the complete document so link definitions and footnotes remain global.
  let offset = 0;
  return markdown.split(/(\r\n|\r|\n)/).map((part, index) => {
    const start = offset;
    offset += part.length;
    if (index % 2) return part;
    const trimmed = part.trim();
    if (!isPageBreakMarker(trimmed) && (!custom || /[\r\n]/.test(custom) || trimmed !== custom)) return part;
    if (protectedRanges.some((range) => start < range.end && offset > range.start)) return part;
    return `\n\n${PAGE_BREAK_MARKER}\n\n`;
  }).join("");
}

/** Normalize markers before remark-rehype resolves references across the document. */
export const remarkDocumentPagination: Plugin<[PaginationOptions?], MarkdownRoot> = function (options = {}) {
  return (tree, file) => {
    if (!options.enabled) return;
    const normalized = this.parse(normalizePageBreaks(String(file), tree, options.marker)) as MarkdownRoot;
    tree.children = normalized.children.map((node) => node.type === "html" && node.value.trim() === PAGE_BREAK_MARKER
      ? { type: "thematicBreak", data: { hProperties: { dataDocumentPageBreak: "true" } } }
      : node);
  };
};

function isVisibleContent(node: HtmlContent): boolean {
  if (node.type === "text") return node.value.trim().length > 0;
  return node.type === "element";
}

/** Run after sanitization, so stripped scripts and comments cannot create empty pages. */
export const rehypeDocumentPagination: Plugin<[PaginationOptions?], HtmlRoot> = function (options = {}) {
  return (tree) => {
    if (!options.enabled) return;
    const pages: ElementContent[][] = [];
    let current: ElementContent[] = [];
    let hasContent = false;
    let pendingBreak = false;
    for (const node of tree.children) {
      if (node.type === "doctype") continue;
      if (node.type === "element" && node.tagName === "hr" && node.properties.dataDocumentPageBreak === "true") {
        pendingBreak = hasContent;
        continue;
      }
      const visible = isVisibleContent(node);
      // remark-rehype appends footnotes at the end; a trailing marker must not
      // move these notes onto an otherwise empty extra page.
      const footnotes = node.type === "element" && node.tagName === "section" && "dataFootnotes" in node.properties;
      if (visible && pendingBreak && !footnotes) {
        pages.push(current);
        current = [];
        hasContent = false;
        pendingBreak = false;
      }
      current.push(node);
      hasContent ||= visible;
    }
    if (hasContent || !pages.length) pages.push(current);
    tree.children = pages.map((children, index): Element => ({
      type: "element",
      tagName: "section",
      properties: { className: ["markdown-paper", "markdown-page"], ariaLabel: `第 ${index + 1} 页，共 ${pages.length} 页` },
      children: [...children, {
        type: "element",
        tagName: "div",
        properties: { className: ["markdown-page-number"] },
        children: [{ type: "text", value: `第 ${index + 1} 页 / 共 ${pages.length} 页` }],
      }],
    }));
  };
};

const headingParser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

export function getMarkdownHeadings(markdown: string, options: PaginationOptions = {}) {
  let tree = headingParser.parse(markdown);
  if (options.enabled) tree = headingParser.parse(normalizePageBreaks(markdown, tree, options.marker));
  const headings: { level: number; text: string }[] = [];
  const getText = (node: MarkdownNode): string => {
    if (node.type === "image" || node.type === "imageReference") return String((node as MarkdownNode & { alt?: string }).alt ?? "");
    if (node.value !== undefined) return String(node.value);
    return (node.children ?? []).map(getText).join("");
  };
  const visit = (node: MarkdownNode & { depth?: number }) => {
    if (node.type === "heading" && node.depth && node.depth <= 3) headings.push({ level: node.depth, text: getText(node) });
    if (node.type === "footnoteDefinition") return;
    for (const child of node.children ?? []) visit(child);
  };
  visit(tree);
  return headings;
}
