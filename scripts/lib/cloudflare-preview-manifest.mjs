const previewSuffix = "/server/preview-props.json";

// OpenNext 1.20.11 omits Next 16.4's mandatory preview-props manifest.
// Inline the actual built manifest; keep unknown-manifest failures intact.
export function inlinePreviewManifest(source, preview) {
  for (const field of ["previewModeId", "previewModeSigningKey", "previewModeEncryptionKey"]) {
    if (typeof preview?.[field] !== "string" || !preview[field]) throw new Error(`Invalid preview manifest field: ${field}`);
  }
  if (source.includes(JSON.stringify(previewSuffix))) return source;
  const pattern = /throw new Error\(`Unexpected loadManifest\(\$\{([\w$]+)\}\) call!`\)/g;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error("OpenNext manifest loader changed; review preview manifest compatibility");
  const match = matches[0];
  const replacement = `if(${match[1]}.endsWith(${JSON.stringify(previewSuffix)}))return ${JSON.stringify(preview)};${match[0]}`;
  return source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length);
}
