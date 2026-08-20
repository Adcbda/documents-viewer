import JSZip from "jszip";
import { unified } from "unified";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";

type MarkdownNode = {
  type: string;
  url?: string;
  identifier?: string;
  children?: MarkdownNode[];
};

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function normalizeLibraryPath(documentPath: string, source: string) {
  const sourcePath = safeDecode(source.split(/[?#]/, 1)[0]).replace(/\\/g, "/");
  const isLibraryAbsolute = sourcePath.startsWith("/library/");
  if (sourcePath.startsWith("/") && !isLibraryAbsolute) return null;

  const parts = isLibraryAbsolute
    ? []
    : documentPath.replace(/\\/g, "/").split("/").slice(0, -1);

  for (const part of (isLibraryAbsolute ? sourcePath.slice(9) : sourcePath).split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else {
      parts.push(part);
    }
  }

  return parts.length ? parts.join("/") : null;
}

function getLibraryFileUrl(file: string) {
  return `/library/${file.split("/").map(encodeURIComponent).join("/")}`;
}

function isLocalImageSource(source: string) {
  return Boolean(source)
    && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source)
    && (!source.startsWith("/") || source.startsWith("/library/"));
}

export function collectMarkdownImageSources(markdown: string) {
  const tree = unified().use(remarkParse).use(remarkGfm).parse(markdown) as MarkdownNode;
  const definitions = new Map<string, string>();
  const sources: string[] = [];

  const walk = (node: MarkdownNode) => {
    if (node.type === "definition" && node.identifier && node.url) {
      definitions.set(node.identifier.toLowerCase(), node.url);
    }
    if (node.type === "image" && node.url) sources.push(node.url);
    if (node.type === "imageReference" && node.identifier) {
      const source = definitions.get(node.identifier.toLowerCase());
      if (source) sources.push(source);
    }
    node.children?.forEach(walk);
  };

  // Definitions can appear after their references, so collect them first.
  const collectDefinitions = (node: MarkdownNode) => {
    if (node.type === "definition" && node.identifier && node.url) {
      definitions.set(node.identifier.toLowerCase(), node.url);
    }
    node.children?.forEach(collectDefinitions);
  };
  collectDefinitions(tree);
  walk(tree);

  return [...new Set(sources)];
}

function safeArchiveDocumentPath(documentPath: string, fallbackTitle: string) {
  const normalized = documentPath.replace(/\\/g, "/").split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
  return normalized || `${fallbackTitle}.md`;
}

function safeDownloadName(title: string) {
  return title
    .split("")
    .filter((character) => character.charCodeAt(0) >= 32)
    .join("")
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/[. ]+$/g, "") || "document";
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportMarkdownBundle(markdown: string, documentPath: string, title: string) {
  const imagePaths = collectMarkdownImageSources(markdown)
    .filter(isLocalImageSource)
    .map((source) => normalizeLibraryPath(documentPath, source))
    .filter((path): path is string => path !== null);
  const uniqueImagePaths = [...new Set(imagePaths)];
  const downloadName = safeDownloadName(title);

  if (!uniqueImagePaths.length) {
    saveBlob(new Blob([markdown], { type: "text/markdown;charset=utf-8" }), `${downloadName}.md`);
    return { bundledImages: 0, filename: `${downloadName}.md` };
  }

  const zip = new JSZip();
  zip.file(safeArchiveDocumentPath(documentPath, downloadName), markdown);

  await Promise.all(uniqueImagePaths.map(async (imagePath) => {
    const response = await fetch(getLibraryFileUrl(imagePath));
    if (!response.ok) throw new Error(`无法下载 Markdown 图片：${imagePath}`);
    zip.file(imagePath, await response.arrayBuffer());
  }));

  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
  saveBlob(blob, `${downloadName}.zip`);
  return { bundledImages: uniqueImagePaths.length, filename: `${downloadName}.zip` };
}
