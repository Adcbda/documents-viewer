import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  type ParagraphChild,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  Tab,
  TextRun,
  WidthType,
} from "docx";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";

type MarkdownNode = { type: string; value?: unknown; children?: MarkdownNode[]; [key: string]: unknown };
type InlineFormatting = { bold?: boolean; italics?: boolean; strike?: boolean };
export type DocxExportOptions = { bodyFontSize?: number };
type DocxTypography = {
  body: number;
  code: number;
  inlineCode: number;
  tableHeader: number;
  title: number;
  heading1: number;
  heading2: number;
  heading3: number;
};

const TEXT_COLOR = "263B36";
const GREEN = "167565";
const LIGHT_GREEN = "E8F2EE";
const LINE = "D8E1DD";

function createTypography(options: DocxExportOptions = {}): DocxTypography {
  const bodyFontSize = Math.min(72, Math.max(5, options.bodyFontSize ?? 10.5));
  const body = Math.round(bodyFontSize * 2);
  const scaled = (defaultSize: number) => Math.max(1, Math.round(defaultSize * body / 21));

  return {
    body,
    code: scaled(18),
    inlineCode: scaled(19),
    tableHeader: scaled(19),
    title: scaled(38),
    heading1: scaled(30),
    heading2: scaled(25),
    heading3: scaled(22),
  };
}

function textRun(text: string, formatting: InlineFormatting = {}, typography = createTypography()) {
  return new TextRun({
    text,
    bold: formatting.bold,
    italics: formatting.italics,
    strike: formatting.strike,
    color: TEXT_COLOR,
    font: { ascii: "Segoe UI", hAnsi: "Segoe UI", eastAsia: "Microsoft YaHei" },
    size: typography.body,
  });
}

function inlineChildren(nodes: readonly MarkdownNode[] = [], formatting: InlineFormatting = {}, typography = createTypography()): ParagraphChild[] {
  return nodes.flatMap((node) => {
    switch (node.type) {
      case "text":
        return [textRun(String((node as { value?: string }).value ?? ""), formatting, typography)];
      case "strong":
        return inlineChildren(node.children, { ...formatting, bold: true }, typography);
      case "emphasis":
        return inlineChildren(node.children, { ...formatting, italics: true }, typography);
      case "delete":
        return inlineChildren(node.children, { ...formatting, strike: true }, typography);
      case "inlineCode":
        return [new TextRun({
          text: String((node as { value?: string }).value ?? ""),
          font: "Consolas",
          size: typography.inlineCode,
          color: "A94836",
          shading: { type: ShadingType.CLEAR, fill: "EEF2F0" },
        })];
      case "link": {
        const link = node as { type: string; url: string; children: MarkdownNode[] };
        return [new ExternalHyperlink({
          link: link.url,
          children: inlineChildren(link.children, formatting, typography).filter((child): child is TextRun => child instanceof TextRun),
        })];
      }
      case "break":
        return [new TextRun({ break: 1 })];
      case "image":
        return [];
      default:
        return "children" in node && Array.isArray(node.children)
          ? inlineChildren(node.children, formatting, typography)
          : [];
    }
  });
}

function getText(node: MarkdownNode): string {
  if ("value" in node && typeof node.value === "string") return node.value;
  return Array.isArray(node.children) ? node.children.map(getText).join("") : "";
}

function codeRuns(value: string, typography: DocxTypography): TextRun[] {
  const lines = value.split(/\r\n|\r|\n/);
  const formatting = { font: "Consolas", color: "E7F1ED", size: typography.code } as const;

  return lines.flatMap((line, index) => {
    const children = line.split("\t").flatMap((part, partIndex) => (
      partIndex === 0 ? [part] : [new Tab(), part]
    ));
    const runs = [new TextRun({ ...formatting, children })];

    if (index < lines.length - 1) {
      runs.push(new TextRun({ ...formatting, break: 1 }));
    }

    return runs;
  });
}

function resolveLibraryUrl(documentPath: string, source: string) {
  if (/^(?:https?:|data:|blob:)/i.test(source)) return source;
  const baseParts = documentPath.split("/").slice(0, -1);
  const sourceParts = decodeURIComponent(source).replace(/^\.\//, "").split("/");
  for (const part of sourceParts) {
    if (part === "..") baseParts.pop();
    else if (part !== ".") baseParts.push(part);
  }
  return `/library/${baseParts.map(encodeURIComponent).join("/")}`;
}

function readImageDimensions(blob: Blob) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(blob);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("无法读取图片尺寸"));
    };
    image.src = objectUrl;
  });
}

async function imageParagraph(source: string, alt: string, documentPath: string, typography: DocxTypography) {
  try {
    const url = resolveLibraryUrl(documentPath, source);
    const response = await fetch(url);
    if (!response.ok) throw new Error("图片下载失败");
    const blob = await response.blob();
    const { width, height } = await readImageDimensions(blob);
    const scale = Math.min(1, 610 / width, 760 / height);
    const extension = source.split(/[?#]/)[0].split(".").pop()?.toLowerCase();
    const type = extension === "jpg" || extension === "jpeg" ? "jpg"
      : extension === "gif" ? "gif"
        : extension === "bmp" ? "bmp" : "png";
    return new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 220, after: 220 },
      children: [new ImageRun({
        type,
        data: await blob.arrayBuffer(),
        transformation: { width: Math.round(width * scale), height: Math.round(height * scale) },
        altText: { title: alt || "文档图片", description: alt || "文档图片", name: alt || "文档图片" },
      })],
    });
  } catch {
    return new Paragraph({ children: [textRun(`[图片：${alt || source}]`, { italics: true }, typography)] });
  }
}

function paragraphOptions(level = 0) {
  return {
    spacing: { after: 120, line: 360 },
    indent: level ? { left: level * 360 } : undefined,
  };
}

async function paragraphBlocks(node: MarkdownNode, documentPath: string, typography: DocxTypography, level = 0) {
  const children = Array.isArray(node.children) ? node.children : [];
  const blocks: (Paragraph | Table)[] = [];
  let textNodes: MarkdownNode[] = [];

  const flushText = () => {
    if (textNodes.length) {
      blocks.push(new Paragraph({ ...paragraphOptions(level), children: inlineChildren(textNodes, {}, typography) }));
      textNodes = [];
    }
  };

  for (const child of children) {
    if (child.type === "image") {
      flushText();
      const image = child as { url?: string; alt?: string };
      blocks.push(await imageParagraph(image.url ?? "", image.alt ?? "", documentPath, typography));
    } else {
      textNodes.push(child);
    }
  }
  flushText();
  return blocks.length ? blocks : [new Paragraph({ ...paragraphOptions(level) })];
}

async function listBlocks(node: MarkdownNode, documentPath: string, typography: DocxTypography, level = 0): Promise<(Paragraph | Table)[]> {
  const ordered = Boolean((node as { ordered?: boolean }).ordered);
  const items = Array.isArray(node.children) ? node.children : [];
  const blocks: (Paragraph | Table)[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const itemChildren = Array.isArray(items[index].children) ? items[index].children! : [];
    for (let childIndex = 0; childIndex < itemChildren.length; childIndex += 1) {
      const child = itemChildren[childIndex];
      if (child.type === "paragraph") {
        const prefix = ordered ? `${index + 1}. ` : "• ";
        blocks.push(new Paragraph({
          ...paragraphOptions(level + 1),
          indent: { left: 440 + level * 360, hanging: 260 },
          children: [textRun(childIndex === 0 ? prefix : "", {}, typography), ...inlineChildren(child.children ?? [], {}, typography)],
        }));
      } else if (child.type === "list") {
        blocks.push(...await listBlocks(child, documentPath, typography, level + 1));
      } else {
        blocks.push(...await blockNode(child, documentPath, typography, level + 1));
      }
    }
  }
  return blocks;
}

function tableBlock(node: MarkdownNode, typography: DocxTypography) {
  const rows = (node.children ?? []).map((rowNode, rowIndex) => new TableRow({
    tableHeader: rowIndex === 0,
    children: (rowNode.children ?? []).map((cellNode) => new TableCell({
      shading: rowIndex === 0 ? { type: ShadingType.CLEAR, fill: LIGHT_GREEN } : undefined,
      margins: { top: 90, bottom: 90, left: 110, right: 110 },
      children: [new Paragraph({
        spacing: { after: 0, line: 300 },
        children: inlineChildren(cellNode.children ?? [], {}, typography).map((child) => {
          if (rowIndex === 0 && child instanceof TextRun) {
            return new TextRun({ text: getText(cellNode), bold: true, color: "21443B", size: typography.tableHeader, font: { eastAsia: "Microsoft YaHei" } });
          }
          return child;
        }),
      })],
    })),
  }));

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    layout: TableLayoutType.AUTOFIT,
    borders: {
      top: { style: BorderStyle.SINGLE, color: LINE, size: 4 },
      bottom: { style: BorderStyle.SINGLE, color: LINE, size: 4 },
      left: { style: BorderStyle.SINGLE, color: LINE, size: 4 },
      right: { style: BorderStyle.SINGLE, color: LINE, size: 4 },
      insideHorizontal: { style: BorderStyle.SINGLE, color: LINE, size: 4 },
      insideVertical: { style: BorderStyle.SINGLE, color: LINE, size: 4 },
    },
  });
}

async function blockNode(node: MarkdownNode, documentPath: string, typography: DocxTypography, level = 0): Promise<(Paragraph | Table)[]> {
  switch (node.type) {
    case "heading": {
      const depth = Number((node as { depth?: number }).depth ?? 1);
      const heading = depth === 1 ? HeadingLevel.TITLE
        : depth === 2 ? HeadingLevel.HEADING_1
          : depth === 3 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      const headingSize = depth === 1 ? typography.title
        : depth === 2 ? typography.heading1
          : depth === 3 ? typography.heading2 : typography.heading3;
      return [new Paragraph({ heading, children: inlineChildren(node.children ?? [], {}, { ...typography, body: headingSize }), spacing: { before: depth === 1 ? 0 : 300, after: 160 }, keepNext: true })];
    }
    case "paragraph":
      return paragraphBlocks(node, documentPath, typography, level);
    case "list":
      return listBlocks(node, documentPath, typography, level);
    case "table":
      return [tableBlock(node, typography)];
    case "blockquote": {
      const blocks: (Paragraph | Table)[] = [];
      for (const child of node.children ?? []) {
        const childBlocks = await blockNode(child, documentPath, typography, level);
        for (const block of childBlocks) {
          if (block instanceof Paragraph) {
            blocks.push(new Paragraph({
              ...paragraphOptions(level),
              border: { left: { style: BorderStyle.SINGLE, color: "C48231", size: 18, space: 10 } },
              shading: { type: ShadingType.CLEAR, fill: "FBF4E8" },
              children: [textRun(getText(child), { italics: true }, typography)],
            }));
          } else blocks.push(block);
        }
      }
      return blocks;
    }
    case "code":
      return [new Paragraph({
        spacing: { before: 100, after: 180 },
        shading: { type: ShadingType.CLEAR, fill: "172622" },
        children: codeRuns(String((node as { value?: string }).value ?? ""), typography),
      })];
    case "thematicBreak":
      return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, color: LINE, size: 4 } }, spacing: { before: 140, after: 180 } })];
    case "html":
      return [];
    default: {
      const blocks: (Paragraph | Table)[] = [];
      for (const child of node.children ?? []) blocks.push(...await blockNode(child, documentPath, typography, level));
      return blocks;
    }
  }
}

export async function createMarkdownDocxBlob(markdown: string, documentPath: string, title: string, options: DocxExportOptions = {}) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown);
  const typography = createTypography(options);
  const children: (Paragraph | Table)[] = [];
  for (const node of tree.children) children.push(...await blockNode(node as MarkdownNode, documentPath, typography));

  const document = new Document({
    title,
    creator: "本地 Markdown 文档阅览室",
    description: "由本地 Markdown 文档导出",
    styles: {
      default: {
        document: {
          run: { color: TEXT_COLOR, size: typography.body, font: { ascii: "Segoe UI", hAnsi: "Segoe UI", eastAsia: "Microsoft YaHei" } },
          paragraph: { spacing: { line: 360, after: 120 } },
        },
        title: { run: { color: "18332E", size: typography.title, bold: true, font: { eastAsia: "Microsoft YaHei" } }, paragraph: { spacing: { after: 300 }, keepNext: true } },
        heading1: { run: { color: GREEN, size: typography.heading1, bold: true, font: { eastAsia: "Microsoft YaHei" } }, paragraph: { spacing: { before: 360, after: 180 }, keepNext: true } },
        heading2: { run: { color: "18332E", size: typography.heading2, bold: true, font: { eastAsia: "Microsoft YaHei" } }, paragraph: { spacing: { before: 280, after: 140 }, keepNext: true } },
        heading3: { run: { color: "284B43", size: typography.heading3, bold: true, font: { eastAsia: "Microsoft YaHei" } }, paragraph: { spacing: { before: 220, after: 100 }, keepNext: true } },
      },
    },
    sections: [{
      properties: { page: { margin: { top: 1100, right: 1100, bottom: 1100, left: 1100 } } },
      children,
    }],
  });

  return Packer.toBlob(document);
}

export async function exportMarkdownToDocx(markdown: string, documentPath: string, title: string, options: DocxExportOptions = {}) {
  const blob = await createMarkdownDocxBlob(markdown, documentPath, title, options);
  const link = window.document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${title.replace(/[<>:"/\\|?*]+/g, "-")}.docx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
