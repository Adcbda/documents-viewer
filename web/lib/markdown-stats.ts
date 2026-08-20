export function countMarkdownLines(markdown: string) {
  if (!markdown) return 0;

  const lines = markdown.split(/\r\n|\r|\n/).length;
  return /(?:\r\n|\r|\n)$/.test(markdown) ? lines - 1 : lines;
}
