import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(scriptDir, "..");
const sourceDir = path.resolve(projectDir, "..", "server");
const outputDir = path.join(projectDir, "public", "library");

async function findLibraryFiles(directory, relativeDir = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findLibraryFiles(path.join(directory, entry.name), relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath.split(path.sep).join("/"));
    }
  }

  return files;
}

await mkdir(outputDir, { recursive: true });
await cp(sourceDir, outputDir, { recursive: true, force: true });

const libraryFiles = await findLibraryFiles(sourceDir);
const availableFiles = new Set(libraryFiles);
const documents = libraryFiles
  .filter((file) => [".md", ".pdf"].includes(path.extname(file).toLowerCase()))
  .map((file) => {
    const extension = path.extname(file).toLowerCase();
    const sourceFile = extension === ".pdf"
      ? file.slice(0, -extension.length) + ".docx"
      : undefined;

    return {
      id: file,
      title: path.basename(file, path.extname(file)),
      file,
      kind: extension === ".pdf" ? "pdf" : "markdown",
      ...(sourceFile && availableFiles.has(sourceFile) ? { sourceFile } : {}),
    };
  })
  .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));

await writeFile(
  path.join(outputDir, "index.json"),
  `${JSON.stringify({ documents }, null, 2)}\n`,
  "utf8",
);

console.log(`Synced ${documents.length} browsable document(s) from ${sourceDir}`);
