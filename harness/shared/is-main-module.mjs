import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function resolveRealPath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

export function isMainModule(importMetaUrl, argvEntry = process.argv[1]) {
  if (!argvEntry) {
    return false;
  }

  return resolveRealPath(fileURLToPath(importMetaUrl)) === resolveRealPath(path.resolve(argvEntry));
}
