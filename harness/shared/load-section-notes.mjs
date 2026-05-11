import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const SECTION_NOTES_DIR = path.posix.join("harness", "notes");

export function getSectionNotesPath(rootDir, pageKey) {
  if (!pageKey || typeof pageKey !== "string") {
    throw new Error("getSectionNotesPath requires a non-empty pageKey.");
  }
  return path.join(rootDir, SECTION_NOTES_DIR, `${pageKey}.json`);
}

export function getSectionNotesRelativePath(pageKey) {
  return path.posix.join(SECTION_NOTES_DIR, `${pageKey}.json`);
}

function sha256(content) {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

function indexBySectionId(sections) {
  const map = new Map();
  for (const entry of sections ?? []) {
    if (entry?.id) {
      map.set(entry.id, entry);
    }
  }
  return map;
}

/**
 * Load harness/notes/<pageKey>.json. Returns:
 *   {
 *     present: boolean,
 *     path: <relative path>,
 *     absolutePath: <absolute path>,
 *     sha256: <sha256:...> | null,
 *     notes: { schemaVersion, manifestType, pageKey, sections } | null,
 *     loadError: Error | null,
 *     lookupBySectionId(id): entry | null
 *   }
 *
 * present=false when the file is absent. loadError is populated for parse / shape errors so
 * downstream callers can surface a clear blocker without crashing the whole flow.
 */
export async function loadSectionNotes({ rootDir, pageKey }) {
  const absolutePath = getSectionNotesPath(rootDir, pageKey);
  const relativePath = getSectionNotesRelativePath(pageKey);

  let raw;
  try {
    raw = await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        present: false,
        path: relativePath,
        absolutePath,
        sha256: null,
        notes: null,
        loadError: null,
        lookupBySectionId: () => null
      };
    }
    return {
      present: false,
      path: relativePath,
      absolutePath,
      sha256: null,
      notes: null,
      loadError: error,
      lookupBySectionId: () => null
    };
  }

  const hash = sha256(raw);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return {
      present: true,
      path: relativePath,
      absolutePath,
      sha256: hash,
      notes: null,
      loadError: error,
      lookupBySectionId: () => null
    };
  }

  if (parsed?.manifestType && parsed.manifestType !== "section-notes") {
    return {
      present: true,
      path: relativePath,
      absolutePath,
      sha256: hash,
      notes: null,
      loadError: new Error(
        `section-notes file at ${relativePath} declares manifestType ${parsed.manifestType}; expected "section-notes".`
      ),
      lookupBySectionId: () => null
    };
  }

  if (parsed?.pageKey && parsed.pageKey !== pageKey) {
    return {
      present: true,
      path: relativePath,
      absolutePath,
      sha256: hash,
      notes: null,
      loadError: new Error(
        `section-notes file at ${relativePath} declares pageKey ${parsed.pageKey}; expected ${pageKey} (the file's basename).`
      ),
      lookupBySectionId: () => null
    };
  }

  const index = indexBySectionId(parsed?.sections);
  return {
    present: true,
    path: relativePath,
    absolutePath,
    sha256: hash,
    notes: parsed,
    loadError: null,
    lookupBySectionId: (id) => index.get(id) ?? null
  };
}
