import assert from "node:assert/strict";
import test from "node:test";

import { buildDocumentTree, documentMatchesQuery } from "../lib/document-tree.ts";

const documents = [
  { id: "root.md", title: "Root", file: "root.md", kind: "markdown" },
  { id: "guides/start.md", title: "Start", file: "guides/start.md", kind: "markdown" },
  { id: "guides/advanced/start.md", title: "Start", file: "guides/advanced/start.md", kind: "markdown" },
  { id: "reports/2026.pdf", title: "2026", file: "reports/2026.pdf", kind: "pdf" },
];

test("builds a browsable tree for documents in nested directories", () => {
  const tree = buildDocumentTree(documents);

  assert.deepEqual(tree.documents.map((document) => document.file), ["root.md"]);
  assert.deepEqual(tree.directories.map((directory) => directory.name), ["guides", "reports"]);
  assert.deepEqual(tree.directories[0].documents.map((document) => document.file), ["guides/start.md"]);
  assert.equal(tree.directories[0].directories[0].path, "guides/advanced");
  assert.deepEqual(
    tree.directories[0].directories[0].documents.map((document) => document.file),
    ["guides/advanced/start.md"],
  );
});

test("searches both document names and their directory paths", () => {
  assert.equal(documentMatchesQuery(documents[1], "start"), true);
  assert.equal(documentMatchesQuery(documents[1], "guides"), true);
  assert.equal(documentMatchesQuery(documents[1], "reports"), false);
});
