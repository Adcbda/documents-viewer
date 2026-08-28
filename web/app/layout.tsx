import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";

const themeInitializationScript = `
  (() => {
    try {
      const savedTheme = localStorage.getItem("document-viewer-theme");
      const theme = savedTheme === "light"
        ? "light"
        : savedTheme === "dark" || savedTheme === "dark-gray"
          ? "dark-gray"
        : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark-gray" : "light");
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
    } catch (_) {}
  })();
`;

export const metadata: Metadata = {
  title: "文档阅览室 · 文档在线阅读与导出",
  description: "在线阅读 Markdown 与 PDF 文档，并支持下载或导出 DOCX。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitializationScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
