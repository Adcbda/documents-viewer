"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { BookOpenText, CheckCircle2, ChevronRight, Download, ExternalLink, FileText, Folder, ListTree, LoaderCircle, Maximize2, Minimize2, Moon, PanelLeftClose, PanelLeftOpen, Search, StretchHorizontal, Sun, Type, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { buildDocumentTree, documentMatchesQuery, type DocumentDirectory, type LibraryDocument } from "../lib/document-tree";
import { markdownHtmlSanitizeSchema } from "../lib/markdown-html";
import { countMarkdownLines } from "../lib/markdown-stats";

type Heading = { id: string; level: number; text: string };
type ExportFormat = "markdown" | "docx" | "pdf";
type ExportState = { format: ExportFormat | null; status: "idle" | "working" | "done" | "error" };
type DocumentTypographyStyle = CSSProperties & Record<`--document-${string}`, string>;
type DocumentTreeStyle = CSSProperties & { "--tree-indent": string };
type WorkspaceStyle = CSSProperties & { "--sidebar-width": string };

const FONT_SIZE_OPTIONS = [
  { label: "初号", value: 42 },
  { label: "小初", value: 36 },
  { label: "一号", value: 26 },
  { label: "小一", value: 24 },
  { label: "二号", value: 22 },
  { label: "小二", value: 18 },
  { label: "三号", value: 16 },
  { label: "小三", value: 15 },
  { label: "四号", value: 14 },
  { label: "小四", value: 12 },
  { label: "五号", value: 10.5 },
  { label: "小五", value: 9 },
  { label: "六号", value: 7.5 },
  { label: "小六", value: 6.5 },
  { label: "七号", value: 5.5 },
  { label: "八号", value: 5 },
];

const THEME_STORAGE_KEY = "document-viewer-theme";
const SIDEBAR_WIDTH_STORAGE_KEY = "document-viewer-sidebar-width";
const SIDEBAR_VISIBILITY_STORAGE_KEY = "document-viewer-sidebar-visible";
const DEFAULT_SIDEBAR_WIDTH = 260;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 480;

function clampSidebarWidth(width: number) {
  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, width));
}

function slugify(value: string, index: number) {
  const slug = value.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
  return `${slug || "section"}-${index}`;
}

function findHeadings(markdown: string): Heading[] {
  let index = 0;
  return markdown.split("\n").map((line) => {
    const match = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line);
    if (!match) return null;
    const heading = { id: slugify(match[2], index), level: match[1].length, text: match[2] };
    index += 1;
    return heading;
  }).filter((heading): heading is Heading => heading !== null);
}

function resolveLibraryUrl(documentPath: string, source?: string) {
  if (!source || /^(?:https?:|data:|blob:)/i.test(source)) return source ?? "";
  const baseParts = documentPath.split("/").slice(0, -1);
  const sourceParts = decodeURIComponent(source).replace(/^\.\//, "").split("/");
  for (const part of sourceParts) {
    if (part === "..") baseParts.pop();
    else if (part !== ".") baseParts.push(part);
  }
  return `/library/${baseParts.map(encodeURIComponent).join("/")}`;
}

function getLibraryFileUrl(file: string) {
  return `/library/${file.split("/").map(encodeURIComponent).join("/")}`;
}

function imageWidthStyle(width: string | number | undefined) {
  if (width === undefined) return undefined;
  return typeof width === "number" ? `${width}px` : width;
}

function documentTypographyStyle(bodyFontSize: number): DocumentTypographyStyle {
  const size = (ratio: number) => `${(bodyFontSize * ratio).toFixed(2)}pt`;
  return {
    "--document-body-font-size": `${bodyFontSize}pt`,
    "--document-title-font-size": size(38 / 21),
    "--document-heading-1-font-size": size(30 / 21),
    "--document-heading-2-font-size": size(25 / 21),
    "--document-heading-3-font-size": size(22 / 21),
    "--document-code-font-size": size(18 / 21),
    "--document-table-font-size": size(19 / 21),
  };
}

function MarkdownContent({
  markdown,
  documentPath,
  headings,
  lineCount,
}: {
  markdown: string;
  documentPath: string;
  headings: Heading[];
  lineCount: number;
}) {
  let headingIndex = 0;
  const headingComponent = (level: 1 | 2 | 3) => {
    const Component = `h${level}` as "h1" | "h2" | "h3";
    return function MarkdownHeading({ children }: { children?: React.ReactNode }) {
      const heading = headings[headingIndex++];
      return <Component id={heading?.id}>{children}</Component>;
    };
  };

  return (
    <>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownHtmlSanitizeSchema], rehypeKatex]}
        components={{
          h1: headingComponent(1), h2: headingComponent(2), h3: headingComponent(3),
          img: ({ src, alt, width, height, style, className, title }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolveLibraryUrl(documentPath, typeof src === "string" ? src : undefined)}
              alt={alt ?? "文档图片"}
              width={width}
              height={height}
              style={width === undefined ? style : { width: imageWidthStyle(width), ...style }}
              className={className}
              title={title}
              loading="lazy"
            />
          ),
        }}
      >
        {markdown}
      </ReactMarkdown>
      <footer className="document-footer"><span>文档结束</span><p>共 {lineCount.toLocaleString("zh-CN")} 行 · 内容来自本地 Markdown 文件</p></footer>
    </>
  );
}

function DocumentTree({
  directory,
  activeDocument,
  selectDocument,
  depth = 0,
}: {
  directory: DocumentDirectory;
  activeDocument: LibraryDocument | null;
  selectDocument: (document: LibraryDocument) => void;
  depth?: number;
}) {
  const indentation: DocumentTreeStyle = { "--tree-indent": `${depth * 14}px` };

  return (
    <>
      {directory.directories.map((childDirectory) => (
        <details className="document-folder" key={childDirectory.path} open>
          <summary style={indentation} title={childDirectory.path}>
            <ChevronRight className="folder-chevron" size={14} />
            <Folder size={16} />
            <span>{childDirectory.name}</span>
          </summary>
          <DocumentTree
            directory={childDirectory}
            activeDocument={activeDocument}
            selectDocument={selectDocument}
            depth={depth + 1}
          />
        </details>
      ))}
      {directory.documents.map((document) => (
        <button
          key={document.id}
          className={document.id === activeDocument?.id ? "document-item active" : "document-item"}
          onClick={() => selectDocument(document)}
          style={indentation}
          title={document.file}
        >
          <FileText size={18} />
          <span>
            <strong>{document.title}</strong>
            <small>{document.kind === "pdf" ? "PDF 在线预览" : "Markdown 文档"}</small>
          </span>
        </button>
      ))}
    </>
  );
}

export default function Home() {
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [activeDocument, setActiveDocument] = useState<LibraryDocument | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [desktopSidebarOpen, setDesktopSidebarOpen] = useState(true);
  const [isCompactViewport, setIsCompactViewport] = useState(false);
  const [readingMode, setReadingMode] = useState(false);
  const [wideMode, setWideMode] = useState(false);
  const [readingTocOpen, setReadingTocOpen] = useState(false);
  const [error, setError] = useState("");
  const [exportState, setExportState] = useState<ExportState>({ format: null, status: "idle" });
  const [bodyFontSize, setBodyFontSize] = useState(10.5);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const sidebarWidthRef = useRef(DEFAULT_SIDEBAR_WIDTH);
  const appShellRef = useRef<HTMLElement | null>(null);
  const nativeFullscreenActiveRef = useRef(false);

  useEffect(() => {
    const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
    const followSystemTheme = (event: MediaQueryListEvent) => {
      try {
        if (window.localStorage.getItem(THEME_STORAGE_KEY)) return;
      } catch {
        // Storage may be disabled; system theme changes should still be applied.
      }
      const nextTheme = event.matches ? "dark-gray" : "light";
      window.document.documentElement.dataset.theme = nextTheme;
      window.document.documentElement.style.colorScheme = nextTheme;
    };
    colorScheme.addEventListener("change", followSystemTheme);
    return () => colorScheme.removeEventListener("change", followSystemTheme);
  }, []);

  useEffect(() => {
    let restoreFrame = 0;
    try {
      const savedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
      const savedVisibility = window.localStorage.getItem(SIDEBAR_VISIBILITY_STORAGE_KEY);
      restoreFrame = window.requestAnimationFrame(() => {
        if (Number.isFinite(savedWidth) && savedWidth > 0) {
          const nextWidth = clampSidebarWidth(savedWidth);
          sidebarWidthRef.current = nextWidth;
          setSidebarWidth(nextWidth);
        }
        if (savedVisibility !== null) setDesktopSidebarOpen(savedVisibility === "true");
      });
    } catch {
      // The sidebar remains resizable when storage is unavailable.
    }
    return () => window.cancelAnimationFrame(restoreFrame);
  }, []);

  useEffect(() => {
    const compactViewport = window.matchMedia("(max-width: 780px)");
    const syncViewport = () => setIsCompactViewport(compactViewport.matches);
    syncViewport();
    compactViewport.addEventListener("change", syncViewport);
    return () => compactViewport.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    const syncFullscreenState = () => {
      if (window.document.fullscreenElement === appShellRef.current) {
        nativeFullscreenActiveRef.current = true;
        setReadingMode(true);
      } else if (nativeFullscreenActiveRef.current) {
        nativeFullscreenActiveRef.current = false;
        setReadingMode(false);
        setReadingTocOpen(false);
      }
    };
    window.document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => window.document.removeEventListener("fullscreenchange", syncFullscreenState);
  }, []);

  useEffect(() => {
    if (!readingMode) return;
    const exitCssReadingMode = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || window.document.fullscreenElement) return;
      setReadingMode(false);
      setReadingTocOpen(false);
    };
    window.addEventListener("keydown", exitCssReadingMode);
    return () => window.removeEventListener("keydown", exitCssReadingMode);
  }, [readingMode]);

  useEffect(() => {
    if (!sidebarResizing) return;
    const root = window.document.documentElement;
    const resizeSidebar = (event: PointerEvent) => {
      const nextWidth = clampSidebarWidth(event.clientX);
      sidebarWidthRef.current = nextWidth;
      setSidebarWidth(nextWidth);
    };
    const finishSidebarResize = () => {
      setSidebarResizing(false);
      try {
        window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidthRef.current));
      } catch {
        // The resized width still applies for the current session.
      }
    };

    root.classList.add("sidebar-resizing");
    window.addEventListener("pointermove", resizeSidebar);
    window.addEventListener("pointerup", finishSidebarResize, { once: true });
    window.addEventListener("pointercancel", finishSidebarResize, { once: true });
    return () => {
      root.classList.remove("sidebar-resizing");
      window.removeEventListener("pointermove", resizeSidebar);
      window.removeEventListener("pointerup", finishSidebarResize);
      window.removeEventListener("pointercancel", finishSidebarResize);
    };
  }, [sidebarResizing]);

  useEffect(() => {
    fetch("/library/index.json")
      .then((response) => {
        if (!response.ok) throw new Error("无法读取文档列表");
        return response.json() as Promise<{ documents: LibraryDocument[] }>;
      })
      .then(({ documents: items }) => { setDocuments(items); setActiveDocument(items[0] ?? null); })
      .catch((reason: Error) => setError(reason.message));
  }, []);

  useEffect(() => {
    if (!activeDocument) return;
    if (activeDocument.kind === "pdf") return;
    fetch(getLibraryFileUrl(activeDocument.file))
      .then((response) => {
        if (!response.ok) throw new Error("无法读取 Markdown 文档");
        return response.text();
      })
      .then(setMarkdown)
      .catch((reason: Error) => setError(reason.message));
  }, [activeDocument]);

  const headings = useMemo(() => findHeadings(markdown), [markdown]);
  const markdownLineCount = useMemo(() => countMarkdownLines(markdown), [markdown]);
  const filteredDocuments = useMemo(
    () => documents.filter((document) => documentMatchesQuery(document, query)),
    [documents, query],
  );
  const documentTree = useMemo(() => buildDocumentTree(filteredDocuments), [filteredDocuments]);
  const activeFileUrl = activeDocument ? getLibraryFileUrl(activeDocument.file) : "";
  const sourceFileUrl = activeDocument?.sourceFile ? getLibraryFileUrl(activeDocument.sourceFile) : "";
  const workspaceStyle: WorkspaceStyle = { "--sidebar-width": `${sidebarWidth}px` };
  const setAndSaveSidebarWidth = (width: number) => {
    const nextWidth = clampSidebarWidth(width);
    sidebarWidthRef.current = nextWidth;
    setSidebarWidth(nextWidth);
    try {
      window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(nextWidth));
    } catch {
      // The resized width still applies for the current session.
    }
  };
  const resizeSidebarWithKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    let nextWidth = sidebarWidth;
    if (event.key === "ArrowLeft") nextWidth -= 10;
    else if (event.key === "ArrowRight") nextWidth += 10;
    else if (event.key === "Home") nextWidth = MIN_SIDEBAR_WIDTH;
    else if (event.key === "End") nextWidth = MAX_SIDEBAR_WIDTH;
    else return;
    event.preventDefault();
    setAndSaveSidebarWidth(nextWidth);
  };
  const toggleSidebar = () => {
    if (isCompactViewport) {
      setSidebarOpen((open) => !open);
      return;
    }
    setDesktopSidebarOpen((open) => {
      const nextOpen = !open;
      try {
        window.localStorage.setItem(SIDEBAR_VISIBILITY_STORAGE_KEY, String(nextOpen));
      } catch {
        // The selected visibility still applies for the current session.
      }
      return nextOpen;
    });
  };
  const enterReadingMode = async () => {
    setSidebarOpen(false);
    setReadingTocOpen(false);
    setReadingMode(true);
    try {
      await appShellRef.current?.requestFullscreen();
      nativeFullscreenActiveRef.current = window.document.fullscreenElement === appShellRef.current;
    } catch {
      // CSS reading mode remains available when native fullscreen is unavailable.
    }
  };
  const exitReadingMode = async () => {
    setReadingTocOpen(false);
    try {
      if (window.document.fullscreenElement) await window.document.exitFullscreen();
    } catch {
      // Leaving the CSS reading layout still gives the user a reliable exit.
    } finally {
      nativeFullscreenActiveRef.current = false;
      setReadingMode(false);
    }
  };
  const selectDocument = (document: LibraryDocument) => {
    setSidebarOpen(false);
    if (document.id === activeDocument?.id) return;
    setActiveDocument(document);
    setMarkdown("");
    setError("");
    setExportState({ format: null, status: "idle" });
  };
  const finishExport = (format: ExportFormat, status: "done" | "error") => {
    setExportState({ format, status });
    window.setTimeout(() => setExportState({ format: null, status: "idle" }), status === "done" ? 2600 : 3200);
  };
  const toggleTheme = () => {
    const root = window.document.documentElement;
    const nextTheme = root.dataset.theme === "dark-gray" ? "light" : "dark-gray";
    root.dataset.theme = nextTheme;
    root.style.colorScheme = nextTheme === "light" ? "light" : "dark";
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The visual theme still changes when storage is unavailable.
    }
  };
  const exportMarkdown = async () => {
    if (!activeDocument || !markdown || exportState.status === "working") return;
    setExportState({ format: "markdown", status: "working" });
    try {
      const { exportMarkdownBundle } = await import("../lib/export-markdown");
      await exportMarkdownBundle(markdown, activeDocument.file, activeDocument.title);
      finishExport("markdown", "done");
    } catch (reason) {
      console.error(reason);
      finishExport("markdown", "error");
    }
  };
  const exportDocx = async () => {
    if (!activeDocument || !markdown || exportState.status === "working") return;
    setExportState({ format: "docx", status: "working" });
    try {
      const { exportMarkdownToDocx } = await import("../lib/export-docx");
      await exportMarkdownToDocx(markdown, activeDocument.file, activeDocument.title, { bodyFontSize });
      finishExport("docx", "done");
    } catch (reason) {
      console.error(reason);
      finishExport("docx", "error");
    }
  };
  const exportPdf = async () => {
    if (!activeDocument || !markdown || exportState.status === "working") return;
    setExportState({ format: "pdf", status: "working" });
    try {
      const images = Array.from(window.document.querySelectorAll<HTMLImageElement>("[data-markdown-document] img"));
      const assetsReady = Promise.allSettled([
        window.document.fonts?.ready,
        ...images.map((image) => image.complete ? image.decode().catch(() => undefined) : new Promise<void>((resolve) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => resolve(), { once: true });
        })),
      ]);
      await Promise.race([assetsReady, new Promise((resolve) => window.setTimeout(resolve, 3000))]);
      const previousTitle = window.document.title;
      try {
        window.document.title = activeDocument.title.replace(/[<>:"/\\|?*]+/g, "-");
        window.print();
      } finally {
        window.document.title = previousTitle;
      }
      finishExport("pdf", "done");
    } catch (reason) {
      console.error(reason);
      finishExport("pdf", "error");
    }
  };
  return (
    <main ref={appShellRef} className={`app-shell ${readingMode ? "reading-mode-active" : ""}`}>
      <header className="topbar">
        <button
          className="icon-button sidebar-toggle"
          type="button"
          onClick={toggleSidebar}
          aria-controls="document-library-sidebar"
          aria-expanded={isCompactViewport ? sidebarOpen : desktopSidebarOpen}
          aria-label={isCompactViewport ? (sidebarOpen ? "关闭文档导航" : "打开文档导航") : (desktopSidebarOpen ? "隐藏文档侧边栏" : "打开文档侧边栏")}
          title={isCompactViewport ? "打开文档导航" : (desktopSidebarOpen ? "隐藏文档侧边栏" : "打开文档侧边栏")}
        >
          {isCompactViewport || !desktopSidebarOpen ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}
        </button>
        <a className="brand" href="#top" aria-label="返回文档顶部">
          <span className="brand-mark"><BookOpenText size={20} /></span>
          <span><strong>文档阅览室</strong><small>MARKDOWN DESK</small></span>
        </a>
        <div className="topbar-spacer" />
        {activeDocument?.kind === "markdown" && (
          <button
            className={`mode-button ${wideMode ? "active" : ""}`}
            type="button"
            onClick={() => setWideMode((active) => !active)}
            aria-label={wideMode ? "退出宽屏模式" : "进入宽屏模式"}
            aria-pressed={wideMode}
            title={wideMode ? "退出宽屏模式" : "Markdown 铺满正文区域"}
          >
            <StretchHorizontal size={17} aria-hidden="true" />
            <span>{wideMode ? "标准宽度" : "宽屏"}</span>
          </button>
        )}
        <button className="mode-button" type="button" onClick={() => void enterReadingMode()} aria-label="进入全屏阅读模式" title="进入全屏阅读模式">
          <Maximize2 size={17} aria-hidden="true" />
          <span>全屏阅读</span>
        </button>
        <button className="theme-toggle" type="button" onClick={toggleTheme} aria-label="切换白天或深灰夜间模式" title="切换白天/深灰夜间模式">
          <Sun className="theme-icon theme-icon-light" size={17} aria-hidden="true" />
          <Moon className="theme-icon theme-icon-dark-gray" size={17} aria-hidden="true" />
        </button>
        {activeDocument?.kind === "pdf" && sourceFileUrl ? (
          <a className="export-button" href={sourceFileUrl} download><Download size={17} />下载原始 DOCX</a>
        ) : (
          <div className="export-actions" aria-label="导出 Markdown 文档">
            <label className="font-size-control">
              <Type size={16} aria-hidden="true" />
              <span>正文字号</span>
              <select value={bodyFontSize} onChange={(event) => setBodyFontSize(Number(event.target.value))} aria-label="选择 DOCX 正文字号">
                {FONT_SIZE_OPTIONS.map((fontSize) => <option key={fontSize.label} value={fontSize.value}>{fontSize.label} · {fontSize.value} 磅</option>)}
              </select>
            </label>
            <button className="export-button export-button-secondary" type="button" disabled={!markdown || exportState.status === "working"} onClick={exportMarkdown} aria-label="下载 Markdown">
              {exportState.format === "markdown" && exportState.status === "working" ? <LoaderCircle className="spinning" size={17} /> : exportState.format === "markdown" && exportState.status === "done" ? <CheckCircle2 size={17} /> : <Download size={17} />}
              <span>{exportState.format === "markdown" && exportState.status === "working" ? "正在打包…" : exportState.format === "markdown" && exportState.status === "done" ? "已下载" : "下载 Markdown"}</span>
            </button>
            <button className="export-button export-button-secondary" type="button" disabled={!markdown || exportState.status === "working"} onClick={exportDocx} aria-label="导出 DOCX">
              {exportState.format === "docx" && exportState.status === "working" ? <LoaderCircle className="spinning" size={17} /> : exportState.format === "docx" && exportState.status === "done" ? <CheckCircle2 size={17} /> : <Download size={17} />}
              <span>{exportState.format === "docx" && exportState.status === "working" ? "正在生成…" : exportState.format === "docx" && exportState.status === "done" ? "已导出" : "导出 DOCX"}</span>
            </button>
            <button className="export-button" type="button" disabled={!markdown || exportState.status === "working"} onClick={exportPdf} aria-label="导出 PDF">
              {exportState.format === "pdf" && exportState.status === "working" ? <LoaderCircle className="spinning" size={17} /> : exportState.format === "pdf" && exportState.status === "done" ? <CheckCircle2 size={17} /> : <Download size={17} />}
              <span>{exportState.format === "pdf" && exportState.status === "working" ? "正在准备…" : exportState.format === "pdf" && exportState.status === "done" ? "已打开" : "导出 PDF"}</span>
            </button>
          </div>
        )}
      </header>

      {readingMode && (
        <div className="reading-mode-toolbar" aria-label="全屏阅读控制">
          <span className="reading-mode-document-title">{activeDocument?.title ?? "文档阅读"}</span>
          {activeDocument?.kind === "markdown" && (
            <>
              <button
                className={`reading-mode-action ${wideMode ? "active" : ""}`}
                type="button"
                onClick={() => setWideMode((active) => !active)}
                aria-label={wideMode ? "退出宽屏模式" : "进入宽屏模式"}
                aria-pressed={wideMode}
                title={wideMode ? "退出宽屏模式" : "Markdown 铺满正文区域"}
              >
                <StretchHorizontal size={17} aria-hidden="true" />
                <span>{wideMode ? "标准宽度" : "宽屏"}</span>
              </button>
              <button className="reading-mode-action reading-mode-toc-button" type="button" onClick={() => setReadingTocOpen((open) => !open)} aria-expanded={readingTocOpen} aria-controls="document-toc">
                <ListTree size={17} />
                <span>目录</span>
              </button>
            </>
          )}
          <button className="reading-mode-action" type="button" onClick={() => void exitReadingMode()} aria-label="退出全屏阅读模式" title="退出全屏阅读模式">
            <Minimize2 size={17} />
            <span>退出全屏</span>
          </button>
        </div>
      )}

      <div className={`workspace ${sidebarResizing ? "sidebar-resizing" : ""} ${desktopSidebarOpen ? "" : "sidebar-hidden"} ${readingMode ? "reading-mode" : ""} ${wideMode && activeDocument?.kind === "markdown" ? "wide-mode" : ""} ${readingTocOpen ? "reading-toc-open" : ""}`} style={workspaceStyle}>
        {sidebarOpen && <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="关闭导航" />}
        {readingMode && readingTocOpen && <button className="reading-toc-backdrop" type="button" onClick={() => setReadingTocOpen(false)} aria-label="关闭本文目录" />}
        <aside id="document-library-sidebar" className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
          <div className="sidebar-heading"><span>文档库</span><button className="icon-button close-sidebar" onClick={() => setSidebarOpen(false)} aria-label="关闭文档导航"><X size={18} /></button></div>
          <label className="search-box"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文档" aria-label="搜索文档" /></label>
          <nav className="document-list" aria-label="文档列表">
            <DocumentTree directory={documentTree} activeDocument={activeDocument} selectDocument={selectDocument} />
            {!filteredDocuments.length && <p className="document-list-empty">没有匹配的文档</p>}
          </nav>
          <div className="source-note"><span>文档来源</span><code>documents/</code></div>
          <button
            type="button"
            className="sidebar-resizer"
            aria-label={`调整文档库侧边栏宽度，当前 ${sidebarWidth} 像素`}
            aria-keyshortcuts="ArrowLeft ArrowRight Home End"
            title="拖动调整宽度，双击恢复默认宽度"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              setSidebarResizing(true);
            }}
            onDoubleClick={() => setAndSaveSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
            onKeyDown={resizeSidebarWithKeyboard}
          />
        </aside>

        <section className="document-stage" id="top">
          {error ? (
            <div className="empty-state"><FileText size={30} /><h1>文档暂时无法打开</h1><p>{error}</p></div>
          ) : activeDocument?.kind === "pdf" ? (
            <section className="pdf-paper" aria-label={`${activeDocument.title} PDF 预览`}>
              <header className="pdf-toolbar">
                <span><FileText size={18} /><strong>{activeDocument.title}</strong><small>PDF 在线预览</small></span>
                <a href={activeFileUrl} target="_blank" rel="noreferrer"><ExternalLink size={16} />新窗口打开</a>
              </header>
              <object className="pdf-viewer" data={`${activeFileUrl}#view=FitH&toolbar=1&navpanes=0`} type="application/pdf">
                <div className="pdf-fallback">
                  <FileText size={36} />
                  <h1>浏览器无法内嵌显示 PDF</h1>
                  <p>你仍然可以在新窗口中打开并浏览这份文档。</p>
                  <a href={activeFileUrl} target="_blank" rel="noreferrer">打开 PDF</a>
                </div>
              </object>
            </section>
          ) : !markdown ? (
            <div className="loading-state"><span /><p>正在整理文档版面…</p></div>
          ) : (
            <article className="markdown-paper markdown-continuous" data-markdown-document style={documentTypographyStyle(bodyFontSize)}>
              <MarkdownContent
                markdown={markdown}
                documentPath={activeDocument?.file ?? ""}
                headings={headings}
                lineCount={markdownLineCount}
              />
            </article>
          )}
        </section>

        <aside className="toc-panel" id="document-toc">
          <p className="toc-title">本文目录</p>
          <nav aria-label="本文目录">
            {activeDocument?.kind === "pdf" ? (
              <>
                <a href={activeFileUrl} target="_blank" rel="noreferrer">新窗口打开 PDF</a>
                {sourceFileUrl && <a href={sourceFileUrl} download>下载原始 DOCX</a>}
              </>
            ) : headings.filter((heading) => heading.level === 2 || heading.level === 3).map((heading) => (
              <a key={heading.id} href={`#${heading.id}`} className={`toc-level-${heading.level}`} onClick={() => setReadingTocOpen(false)}>{heading.text}</a>
            ))}
          </nav>
        </aside>
      </div>
      {exportState.status === "error" && <div className="toast error-toast" role="alert">导出失败，请稍后重试</div>}
      {exportState.status === "done" && <div className="toast success-toast" role="status">{exportState.format === "pdf" ? "请在打印窗口中选择“另存为 PDF”" : exportState.format === "markdown" ? "Markdown 下载文件已保存" : "DOCX 已保存到下载目录"}</div>}
    </main>
  );
}
