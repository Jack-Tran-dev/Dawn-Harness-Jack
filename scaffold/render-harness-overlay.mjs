import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

import {
  HARNESS_PACKAGE_SCRIPTS,
  OVERLAY_COPY_FILES,
  OVERLAY_GENERATED_FILES,
  listOverlayOwnedFiles
} from "./overlay-files.mjs";

const OVERLAY_SOURCE_PREFIX = "scaffold/overlay/";

function resolveTargetPath(sourceRelativePath) {
  if (sourceRelativePath.startsWith(OVERLAY_SOURCE_PREFIX)) {
    return sourceRelativePath.slice(OVERLAY_SOURCE_PREFIX.length);
  }
  return sourceRelativePath;
}

function readRootVersion(sourceRoot) {
  const packageJsonPath = path.join(sourceRoot, "package.json");
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).version ?? "0.1.0-dev";
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function mergePackageJson(targetDir) {
  const packageJsonPath = path.join(targetDir, "package.json");
  const packageJson = fs.existsSync(packageJsonPath)
    ? JSON.parse(fs.readFileSync(packageJsonPath, "utf8"))
    : {
        name: path.basename(targetDir),
        private: true
      };

  packageJson.scripts = {
    ...(packageJson.scripts ?? {}),
    ...HARNESS_PACKAGE_SCRIPTS
  };

  writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
}

function metadataPath(targetDir) {
  return path.join(targetDir, ".shopify-theme-harness", "scaffold.json");
}

function loadMetadata(targetDir) {
  const filePath = metadataPath(targetDir);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeMetadata({ sourceRoot, targetDir, fileHashes }) {
  const metadataPath = path.join(targetDir, ".shopify-theme-harness", "scaffold.json");
  const metadata = {
    version: readRootVersion(sourceRoot),
    ownedFiles: listOverlayOwnedFiles(),
    managedPackageScripts: Object.keys(HARNESS_PACKAGE_SCRIPTS).sort((left, right) => left.localeCompare(right)),
    fileHashes
  };

  writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
}

function desiredOverlayContents(sourceRoot) {
  const desired = new Map();

  for (const sourcePath of OVERLAY_COPY_FILES) {
    const targetPath = resolveTargetPath(sourcePath);
    desired.set(targetPath, fs.readFileSync(path.join(sourceRoot, sourcePath), "utf8"));
  }

  for (const [relativePath, content] of Object.entries(OVERLAY_GENERATED_FILES)) {
    desired.set(relativePath, content);
  }

  return desired;
}

export function readHarnessOverlayStatus(targetDir) {
  const projectRoot = fs.realpathSync(targetDir);
  const metadata = loadMetadata(projectRoot);

  if (!metadata) {
    return {
      projectRoot,
      installed: false,
      version: null,
      ownedFileCount: 0,
      modifiedOwnedFiles: [],
      missingOwnedFiles: []
    };
  }

  const modifiedOwnedFiles = [];
  const missingOwnedFiles = [];

  for (const relativePath of metadata.ownedFiles ?? []) {
    const targetPath = path.join(projectRoot, relativePath);
    const expectedHash = metadata.fileHashes?.[relativePath] ?? null;

    if (!fs.existsSync(targetPath)) {
      missingOwnedFiles.push(relativePath);
      continue;
    }

    if (!expectedHash) {
      continue;
    }

    const currentHash = hashContent(fs.readFileSync(targetPath, "utf8"));
    if (currentHash !== expectedHash) {
      modifiedOwnedFiles.push(relativePath);
    }
  }

  return {
    projectRoot,
    installed: true,
    version: metadata.version ?? null,
    ownedFileCount: (metadata.ownedFiles ?? []).length,
    modifiedOwnedFiles: modifiedOwnedFiles.sort((left, right) => left.localeCompare(right)),
    missingOwnedFiles: missingOwnedFiles.sort((left, right) => left.localeCompare(right)),
    managedPackageScripts: [...(metadata.managedPackageScripts ?? [])].sort((left, right) =>
      left.localeCompare(right)
    )
  };
}

export function installHarnessOverlay({
  sourceRoot,
  targetDir,
  mode = "install"
}) {
  ensureDir(targetDir);
  const previousMetadata = loadMetadata(targetDir);
  const previousFileHashes = previousMetadata?.fileHashes ?? {};
  const fileHashes = { ...previousFileHashes };
  const desiredContents = desiredOverlayContents(sourceRoot);
  const skippedModifiedFiles = [];
  const writtenFiles = [];

  for (const [relativePath, desiredContent] of desiredContents.entries()) {
    const targetPath = path.join(targetDir, relativePath);
    const currentExists = fs.existsSync(targetPath);
    const currentContent = currentExists ? fs.readFileSync(targetPath, "utf8") : null;
    const currentHash = currentContent === null ? null : hashContent(currentContent);
    const previousHash = previousFileHashes[relativePath] ?? null;
    const shouldProtectLocalEdit =
      mode === "upgrade" &&
      currentExists &&
      previousHash &&
      currentHash !== previousHash;

    if (shouldProtectLocalEdit) {
      skippedModifiedFiles.push(relativePath);
      continue;
    }

    writeFile(targetPath, desiredContent);
    fileHashes[relativePath] = hashContent(desiredContent);
    writtenFiles.push(relativePath);
  }

  mergePackageJson(targetDir);
  writeMetadata({ sourceRoot, targetDir, fileHashes });

  return {
    targetDir,
    ownedFileCount: listOverlayOwnedFiles().length,
    writtenFiles,
    skippedModifiedFiles
  };
}

export function projectHasHarness(projectRoot) {
  return fs.existsSync(metadataPath(projectRoot));
}
