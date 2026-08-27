export type LibraryDocument = {
  id: string;
  title: string;
  file: string;
  kind: "markdown" | "pdf";
  sourceFile?: string;
};

export type DocumentDirectory = {
  name: string;
  path: string;
  directories: DocumentDirectory[];
  documents: LibraryDocument[];
};

type MutableDocumentDirectory = Omit<DocumentDirectory, "directories"> & {
  directories: MutableDocumentDirectory[];
  directoryMap: Map<string, MutableDocumentDirectory>;
};

const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });

export function buildDocumentTree(documents: LibraryDocument[]): DocumentDirectory {
  const root: MutableDocumentDirectory = {
    name: "",
    path: "",
    directories: [],
    documents: [],
    directoryMap: new Map(),
  };

  for (const document of documents) {
    const pathParts = document.file.replace(/\\/g, "/").split("/").filter(Boolean);
    let current = root;

    for (const directoryName of pathParts.slice(0, -1)) {
      let child = current.directoryMap.get(directoryName);
      if (!child) {
        child = {
          name: directoryName,
          path: current.path ? `${current.path}/${directoryName}` : directoryName,
          directories: [],
          documents: [],
          directoryMap: new Map(),
        };
        current.directoryMap.set(directoryName, child);
        current.directories.push(child);
      }
      current = child;
    }

    current.documents.push(document);
  }

  const sortDirectory = (directory: MutableDocumentDirectory) => {
    directory.directories.sort((a, b) => collator.compare(a.name, b.name));
    directory.documents.sort((a, b) => collator.compare(a.title, b.title));
    directory.directories.forEach(sortDirectory);
  };
  sortDirectory(root);

  return root;
}

export function documentMatchesQuery(document: LibraryDocument, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  if (!normalizedQuery) return true;
  return `${document.title}\n${document.file}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
}
