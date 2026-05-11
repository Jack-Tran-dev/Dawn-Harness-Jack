import path from "node:path";

import { PAGE_KEY_PATTERN } from "./resolve-page-key.mjs";

export class SourceManifestPathError extends Error {
  constructor(message, { code, details } = {}) {
    super(message);
    this.name = "SourceManifestPathError";
    this.code = code ?? "ERR_SOURCE_MANIFEST_PATH";
    if (details) {
      this.details = details;
    }
  }
}

function validatePageKey(pageKey) {
  if (typeof pageKey !== "string" || pageKey.length === 0) {
    throw new SourceManifestPathError(
      `resolveSourceManifestPath requires a non-empty page-key string. Got ${
        pageKey === undefined ? "undefined" : JSON.stringify(pageKey)
      }.`,
      { code: "ERR_SOURCE_MANIFEST_PAGE_KEY_INVALID" }
    );
  }
  if (!PAGE_KEY_PATTERN.test(pageKey)) {
    throw new SourceManifestPathError(
      `Page-key "${pageKey}" does not match ${PAGE_KEY_PATTERN}. ` +
        "Use lowercase letters, digits, and hyphens only (e.g. \"pococo-home\").",
      { code: "ERR_SOURCE_MANIFEST_PAGE_KEY_INVALID", details: { pageKey } }
    );
  }
}

export function resolveSourceManifestPath({ pageKey, rootDir } = {}) {
  validatePageKey(pageKey);
  const relative = `figma/${pageKey}/source-manifest.json`;
  const result = { pageKey, relative };
  if (rootDir) {
    result.absolute = path.join(rootDir, "figma", pageKey, "source-manifest.json");
  }
  return result;
}
