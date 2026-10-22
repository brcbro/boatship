import type { DocumentRecord } from "@/types";

export function documentMetadata(document: DocumentRecord): DocumentRecord {
  const result = { ...document };
  delete result.contentBase64;
  delete result.contentId;
  result.contentAvailable = Boolean(document.contentId || document.contentBase64);
  result.versions = document.versions.map((version) => {
    const metadata = { ...version };
    delete metadata.contentBase64;
    delete metadata.contentId;
    metadata.contentAvailable = Boolean(version.contentId || version.contentBase64);
    return metadata;
  });
  return result;
}
