import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const sourceDir = path.resolve(projectDir, "..", "server");
const outputDir = path.join(projectDir, "public", "library");

async function findMarkdownFiles(directory, relativeDir = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findMarkdownFiles(path.join(directory, entry.name), relativePath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      files.push(relativePath.split(path.sep).join("/"));
    }
  }

  return files;
}

await mkdir(outputDir, { recursive: true });
await cp(sourceDir, outputDir, { recursive: true, force: true });

const markdownFiles = (await findMarkdownFiles(sourceDir)).sort((a, b) =>
  a.localeCompare(b, "zh-CN"),
);
const documents = markdownFiles.map((file) => ({
  id: file,
  title: path.basename(file, path.extname(file)),
  file,
}));

await writeFile(
  path.join(outputDir, "index.json"),
  `${JSON.stringify({ documents }, null, 2)}\n`,
  "utf8",
);

console.log(`Synced ${documents.length} Markdown document(s) from ${sourceDir}`);
