import type { LibraryDocument } from "./document-tree";

const DEFAULT_ORIGIN = "https://document-viewer.invalid";

export function getDocumentViewerUrl(file: string, hash = ""): string {
  const query = new URLSearchParams({ document: file });
  const fragment = hash && !hash.startsWith("#") ? `#${hash}` : hash;
  return `/?${query}${fragment}`;
}

type DocumentLink = {
  href: string | undefined;
  document?: LibraryDocument;
  hash: string;
};

// URL resolution clamps traversal at the origin root. Check it before resolving
// so an out-of-library relative path cannot accidentally select a root document.
function leavesLibrary(documentPath: string, relativePath: string): boolean {
  let depth = documentPath.split("/").length - 1;
  const path = relativePath.split(/[?#]/, 1)[0].replace(/\\/g, "/");
  for (const encodedPart of path.split("/")) {
    const part = decodeURIComponent(encodedPart);
    if (part === "..") {
      if (depth === 0) return true;
      depth -= 1;
    } else if (part && part !== ".") {
      depth += 1;
    }
  }
  return false;
}

export function resolveDocumentLink(
  documentPath: string,
  href: string | undefined,
  documents: LibraryDocument[],
  origin = DEFAULT_ORIGIN,
): DocumentLink {
  const unchanged: DocumentLink = { href, hash: "" };
  const source = href?.trim();
  if (!source || source.startsWith("#")) return unchanged;

  try {
    const site = new URL(origin);
    const basePath = documentPath.split("/").map(encodeURIComponent).join("/");
    const url = new URL(source, new URL(`/library/${basePath}`, site));
    if (!/^https?:$/.test(url.protocol) || url.origin !== site.origin) return unchanged;

    const isRelative = !/^(?:[a-z][a-z\d+.-]*:|[/\\])/i.test(source);
    if (isRelative && leavesLibrary(documentPath, source)) return unchanged;

    const isLibraryPath = url.pathname.startsWith("/library/");
    if (isRelative && !isLibraryPath) return unchanged;
    const encodedFile = url.pathname.slice(isLibraryPath ? "/library/".length : 1);
    const file = decodeURIComponent(encodedFile);
    const document = documents.find((item) => item.file === file);
    if (document) {
      return { href: getDocumentViewerUrl(document.file, url.hash), document, hash: url.hash };
    }

    // Attachments belong to the current document's directory. Unknown absolute
    // URLs may be application routes, so leave them to the browser unchanged.
    return isRelative
      ? { href: `${url.pathname}${url.search}${url.hash}`, hash: url.hash }
      : unchanged;
  } catch {
    // Invalid percent escapes or malformed URLs must not break the document.
    return unchanged;
  }
}
