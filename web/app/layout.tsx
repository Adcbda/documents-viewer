import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "文档阅览室 · Markdown 阅读与导出",
  description: "本地 Markdown 文档阅读、导航与 DOCX 导出工具。",
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
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
