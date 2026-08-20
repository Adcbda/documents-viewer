import { createReadStream } from "node:fs";
import { readdir, realpath, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";

const publicPort = Number(process.env.PORT || 3000);
const appPort = Number(process.env.APP_INTERNAL_PORT || 3001);
const hostname = process.env.HOSTNAME || "0.0.0.0";
const libraryDir = path.resolve(process.env.LIBRARY_DIR || "/app/public/library");
const libraryRealPath = await realpath(libraryDir);

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

async function findLibraryFiles(directory, relativeDir = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findLibraryFiles(path.join(directory, entry.name), relativePath)));
    } else if (entry.isFile() && entry.name !== "index.json") {
      files.push(relativePath.split(path.sep).join("/"));
    }
  }

  return files;
}

async function serveLibraryIndex(response) {
  const libraryFiles = await findLibraryFiles(libraryRealPath);
  const availableFiles = new Set(libraryFiles);
  const documents = libraryFiles
    .filter((file) => [".md", ".pdf"].includes(path.extname(file).toLowerCase()))
    .map((file) => {
      const extension = path.extname(file).toLowerCase();
      const sourceFile = extension === ".pdf"
        ? `${file.slice(0, -extension.length)}.docx`
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

  const body = `${JSON.stringify({ documents }, null, 2)}\n`;
  response.writeHead(200, {
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
    "content-type": "application/json; charset=utf-8",
  });
  response.end(body);
}

function parseRange(rangeHeader, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader || "");
  if (!match || (!match[1] && !match[2])) return null;

  let start;
  let end;
  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(size - suffixLength, 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) {
    return null;
  }
  return { start, end: Math.min(end, size - 1) };
}

async function serveLibraryFile(request, response, encodedPath) {
  let relativePath;
  try {
    relativePath = encodedPath.split("/").map(decodeURIComponent).join(path.sep);
  } catch {
    response.writeHead(400).end("Bad request");
    return;
  }

  const candidate = path.resolve(libraryRealPath, relativePath);
  if (candidate !== libraryRealPath && !candidate.startsWith(`${libraryRealPath}${path.sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  let filePath;
  let fileStat;
  try {
    filePath = await realpath(candidate);
    if (!filePath.startsWith(`${libraryRealPath}${path.sep}`)) throw new Error("Outside library");
    fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
  } catch {
    response.writeHead(404).end("Not found");
    return;
  }

  const headers = {
    "accept-ranges": "bytes",
    "cache-control": "no-cache",
    "content-type": mimeTypes.get(path.extname(filePath).toLowerCase()) || "application/octet-stream",
    "last-modified": fileStat.mtime.toUTCString(),
  };
  const requestedRange = request.headers.range;
  const range = requestedRange ? parseRange(requestedRange, fileStat.size) : null;

  if (requestedRange && !range) {
    response.writeHead(416, { ...headers, "content-range": `bytes */${fileStat.size}` }).end();
    return;
  }

  if (range) {
    const contentLength = range.end - range.start + 1;
    response.writeHead(206, {
      ...headers,
      "content-length": contentLength,
      "content-range": `bytes ${range.start}-${range.end}/${fileStat.size}`,
    });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath, range).pipe(response);
    return;
  }

  response.writeHead(200, { ...headers, "content-length": fileStat.size });
  if (request.method === "HEAD") response.end();
  else createReadStream(filePath).pipe(response);
}

function proxyToApplication(request, response) {
  const upstream = http.request({
    hostname: "127.0.0.1",
    port: appPort,
    method: request.method,
    path: request.url,
    headers: { ...request.headers, host: request.headers.host },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });

  upstream.on("error", () => {
    if (!response.headersSent) response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
    response.end("Application is starting");
  });
  request.pipe(upstream);
}

const application = spawn(process.execPath, ["server.js"], {
  env: { ...process.env, HOSTNAME: "127.0.0.1", PORT: String(appPort) },
  stdio: "inherit",
});

const server = http.createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
  if (url.pathname === "/library/index.json") {
    serveLibraryIndex(response).catch((error) => {
      console.error("[library] Failed to build document index", error);
      if (!response.headersSent) response.writeHead(500);
      response.end("Failed to build document index");
    });
    return;
  }
  if (url.pathname.startsWith("/library/")) {
    serveLibraryFile(request, response, url.pathname.slice("/library/".length)).catch((error) => {
      console.error("[library] Failed to serve document", error);
      if (!response.headersSent) response.writeHead(500);
      response.end("Failed to serve document");
    });
    return;
  }
  proxyToApplication(request, response);
});

server.listen(publicPort, hostname, () => {
  console.log(`[library] Serving ${libraryRealPath} at http://${hostname}:${publicPort}/library/`);
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  server.close(() => process.exit(0));
  application.kill(signal);
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
application.on("exit", (code, signal) => {
  if (!shuttingDown) {
    console.error(`[library] Application exited (${signal || code})`);
    process.exit(code ?? 1);
  }
});
