#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import util from "node:util";

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--overwrite") {
      options.overwrite = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

function requireOption(options, key) {
  const value = options[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new Error(`Missing required --${key}`);
}

function parseFigmaFrameUrl(rawUrl) {
  const url = new URL(rawUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  const fileKey = parts[1];
  const nodeId = url.searchParams.get("node-id");

  if (!fileKey) {
    throw new Error(`Figma URL is missing file key: ${rawUrl}`);
  }
  if (!nodeId) {
    throw new Error(`Figma URL is missing node-id: ${rawUrl}`);
  }

  return {
    fileKey,
    frameId: nodeId.replace(/-/g, ":")
  };
}

function frameIdForPath(value) {
  return value.replace(/:/g, "-");
}

function classificationFileNameKey(fileKey, desktopFrameId, mobileFrameId) {
  return `${fileKey}__${frameIdForPath(desktopFrameId)}__${frameIdForPath(mobileFrameId)}`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function handles(values, key = "handle") {
  return new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => value?.[key])
      .filter((value) => typeof value === "string")
  );
}

function validateDocument(document, shopContext, expected) {
  const errors = [];
  if (document.schemaVersion !== "1.0.0") {
    errors.push(`Unsupported classification schema '${document.schemaVersion}'.`);
  }
  if (document.fileKey !== expected.fileKey) {
    errors.push(`Classification fileKey '${document.fileKey}' does not match '${expected.fileKey}'.`);
  }
  if (document.desktopFrameId !== expected.desktopFrameId) {
    errors.push(`Classification desktopFrameId '${document.desktopFrameId}' does not match '${expected.desktopFrameId}'.`);
  }
  if (document.mobileFrameId !== expected.mobileFrameId) {
    errors.push(`Classification mobileFrameId '${document.mobileFrameId}' does not match '${expected.mobileFrameId}'.`);
  }

  const productHandles = handles(shopContext.products);
  const collectionHandles = handles(shopContext.collections);
  const blogHandles = handles(shopContext.blogs);
  const metaobjectTypes = handles(shopContext.metaobjectDefinitions, "type");

  for (const [sectionId, section] of Object.entries(document.sections ?? {})) {
    const binding = section?.binding;
    if (!binding) {
      continue;
    }
    if (binding.kind === "product" && !productHandles.has(binding.handle)) {
      errors.push(`Section '${sectionId}' references missing product handle '${binding.handle}'.`);
    }
    if (binding.kind === "collection" && !collectionHandles.has(binding.handle)) {
      errors.push(`Section '${sectionId}' references missing collection handle '${binding.handle}'.`);
    }
    if (binding.kind === "article" && !blogHandles.has(binding.blog)) {
      errors.push(`Section '${sectionId}' references missing blog handle '${binding.blog}'.`);
    }
    if (binding.kind === "metaobject" && !metaobjectTypes.has(binding.type)) {
      errors.push(`Section '${sectionId}' references missing metaobject definition '${binding.type}'.`);
    }
  }

  return errors;
}

function structuredDiff(previous, next) {
  return util.inspect(
    {
      previous,
      next
    },
    {
      depth: 6,
      colors: false,
      compact: false
    }
  );
}

export function run(argv, cwd = process.cwd()) {
  const options = parseArgs(argv);
  const desktop = parseFigmaFrameUrl(requireOption(options, "desktop-url"));
  const mobile = parseFigmaFrameUrl(requireOption(options, "mobile-url"));

  if (desktop.fileKey !== mobile.fileKey) {
    throw new Error("Desktop and mobile URLs must reference the same Figma file.");
  }

  const shopContext = readJson(path.resolve(cwd, requireOption(options, "shop-context-json")));
  const classification = readJson(path.resolve(cwd, requireOption(options, "classification-json")));
  const outputPath = path.resolve(
    cwd,
    options.output ??
      path.join(
        "figma",
        "classifications",
        `${classificationFileNameKey(desktop.fileKey, desktop.frameId, mobile.frameId)}.json`
      )
  );

  const errors = validateDocument(classification, shopContext, {
    fileKey: desktop.fileKey,
    desktopFrameId: desktop.frameId,
    mobileFrameId: mobile.frameId
  });
  if (errors.length > 0) {
    throw new Error(errors.join("\n"));
  }

  if (fs.existsSync(outputPath) && !options.overwrite) {
    const previous = readJson(outputPath);
    throw new Error(
      [
        `Classification output already exists: ${path.relative(cwd, outputPath)}`,
        "Re-run with --overwrite after reviewing this diff:",
        structuredDiff(previous, classification)
      ].join("\n")
    );
  }

  writeJson(outputPath, classification);
  return path.relative(cwd, outputPath);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(`${run(process.argv.slice(2))}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
