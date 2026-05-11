import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { isMainModule } from "../../harness/shared/is-main-module.mjs";
import { resolvePageKey } from "../../harness/shared/resolve-page-key.mjs";
import { resolveSourceManifestPath } from "../../harness/shared/resolve-source-manifest-path.mjs";

const DEFAULT_API_BASE = "https://api.figma.com";
const DEFAULT_TOKEN_ENV = "FIGMA_ACCESS_TOKEN";

const MIME_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
  "image/gif": "gif"
};

function cleanApiBase(apiBase) {
  return apiBase.replace(/\/+$/, "");
}

function makeFigmaUrl(apiBase, pathname, searchParams = {}) {
  const url = new URL(pathname, `${cleanApiBase(apiBase)}/`);
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function slugify(value) {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "asset";
}

function shortHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 10);
}

function sha256(buffer) {
  return `sha256:${crypto.createHash("sha256").update(buffer).digest("hex")}`;
}

function firstFigmaFileKey(sourceManifest) {
  const candidates = [
    sourceManifest.desktopFrame?.figma?.fileKey,
    sourceManifest.mobileFrame?.figma?.fileKey
  ];

  for (const section of sourceManifest.sections ?? []) {
    candidates.push(section.source?.desktop?.figma?.fileKey);
    candidates.push(section.source?.mobile?.figma?.fileKey);
  }

  return candidates.find((candidate) => typeof candidate === "string" && candidate.length > 0) ?? null;
}

function collectSectionNodeRefs(sourceManifest) {
  const refs = [];
  for (const section of sourceManifest.sections ?? []) {
    for (const breakpoint of ["desktop", "mobile"]) {
      const nodeRef = section.source?.[breakpoint];
      if (!nodeRef?.nodeId) {
        continue;
      }
      refs.push({
        sectionId: section.id,
        breakpoint,
        nodeId: nodeRef.nodeId,
        nodeName: nodeRef.nodeName ?? section.name ?? nodeRef.nodeId
      });
    }
  }
  return refs;
}

function imageRefFromFill(fill) {
  return fill?.imageRef ?? fill?.imageHash ?? fill?.ref ?? null;
}

function collectImageFillCandidates(node, sourceRef, candidates = []) {
  const fills = Array.isArray(node?.fills) ? node.fills : [];
  for (const fill of fills) {
    if (fill?.type !== "IMAGE") {
      continue;
    }
    const imageRef = imageRefFromFill(fill);
    if (!imageRef) {
      continue;
    }
    candidates.push({
      imageRef,
      sectionId: sourceRef.sectionId,
      breakpoint: sourceRef.breakpoint,
      nodeId: node.id ?? sourceRef.nodeId,
      nodeName: node.name ?? sourceRef.nodeName
    });
  }

  for (const child of node?.children ?? []) {
    collectImageFillCandidates(child, sourceRef, candidates);
  }

  return candidates;
}

async function fetchJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    headers: {
      "X-Figma-Token": token
    }
  });

  if (!response.ok) {
    throw new Error(`Figma REST request failed: ${url} returned ${response.status} ${response.statusText}`);
  }

  return response.json();
}

async function downloadBinary(fetchImpl, url) {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Asset download failed: ${url} returned ${response.status} ${response.statusText}`);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: response.headers?.get?.("content-type")?.split(";")[0]?.trim() ?? "application/octet-stream"
  };
}

function extensionFor({ mimeType, url }) {
  if (MIME_EXTENSIONS[mimeType]) {
    return MIME_EXTENSIONS[mimeType];
  }

  try {
    const extension = path.extname(new URL(url).pathname).replace(/^\./, "");
    return extension || "bin";
  } catch {
    return "bin";
  }
}

function assetIdFor(candidate) {
  return [
    slugify(candidate.sectionId),
    candidate.breakpoint,
    slugify(candidate.nodeName),
    shortHash(`${candidate.nodeId}:${candidate.imageRef}`)
  ].join("-");
}

function parseArgs(argv) {
  const options = {
    pageKey: null,
    rootDir: process.cwd(),
    outputDir: "design-assets",
    fileKey: null,
    tokenEnv: DEFAULT_TOKEN_ENV,
    apiBase: DEFAULT_API_BASE
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--page") {
      options.pageKey = argv[++index];
    } else if (arg === "--root") {
      options.rootDir = path.resolve(argv[++index]);
    } else if (arg === "--output-dir") {
      options.outputDir = argv[++index];
    } else if (arg === "--file-key") {
      options.fileKey = argv[++index];
    } else if (arg === "--token-env") {
      options.tokenEnv = argv[++index];
    } else if (arg === "--api-base") {
      options.apiBase = argv[++index];
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function usage() {
  return [
    "Usage: node scripts/figma/extract-assets.mjs --page <page-key> [options]",
    "",
    "Options:",
    "  --page <page-key>         Page-key (required; resolves manifest at figma/<page-key>/source-manifest.json)",
    "  --root <path>             Project root (default: cwd)",
    "  --output-dir <path>       Output asset directory (default: design-assets)",
    "  --file-key <key>          Figma file key override when the manifest has no fileKey",
    "  --token-env <name>        Env var containing the Figma token (default: FIGMA_ACCESS_TOKEN)",
    "  --api-base <url>          Figma API base URL (default: https://api.figma.com)"
  ].join("\n");
}

export async function extractFigmaAssets({
  pageKey,
  rootDir = process.cwd(),
  outputDir = "design-assets",
  fileKey = null,
  tokenEnv = DEFAULT_TOKEN_ENV,
  apiBase = DEFAULT_API_BASE,
  env = process.env,
  fetchImpl = globalThis.fetch,
  now = () => new Date()
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new Error("A fetch implementation is required to extract Figma assets");
  }

  if (!pageKey) {
    throw new Error("extractFigmaAssets requires { pageKey }; pass --page <page-key> on the CLI.");
  }

  const sourceManifestLocation = resolveSourceManifestPath({ pageKey, rootDir });

  const token = env[tokenEnv];
  if (!token) {
    throw new Error(`Missing ${tokenEnv}; set it to a Figma personal access token before extracting assets`);
  }

  const sourceManifest = JSON.parse(await fs.readFile(sourceManifestLocation.absolute, "utf8"));
  const resolvedFileKey = fileKey ?? firstFigmaFileKey(sourceManifest);
  if (!resolvedFileKey) {
    throw new Error(
      `Missing figma.fileKey in ${sourceManifestLocation.relative}; pass --file-key to extract assets`
    );
  }

  const sourceRefs = collectSectionNodeRefs(sourceManifest);
  const nodeIds = [...new Set(sourceRefs.map((sourceRef) => sourceRef.nodeId))];
  const nodesPayload = await fetchJson(
    fetchImpl,
    makeFigmaUrl(apiBase, `/v1/files/${resolvedFileKey}/nodes`, {
      ids: nodeIds.join(",")
    }),
    token
  );

  const candidates = [];
  for (const sourceRef of sourceRefs) {
    const documentNode = nodesPayload.nodes?.[sourceRef.nodeId]?.document;
    if (!documentNode) {
      throw new Error(`Figma node ${sourceRef.nodeId} was not returned by the nodes endpoint`);
    }
    collectImageFillCandidates(documentNode, sourceRef, candidates);
  }

  const imagesPayload = await fetchJson(
    fetchImpl,
    makeFigmaUrl(apiBase, `/v1/files/${resolvedFileKey}/images`),
    token
  );
  const imageUrls = imagesPayload.meta?.images ?? imagesPayload.images ?? {};

  await fs.mkdir(path.join(outputDir, "images"), { recursive: true });

  const assets = [];
  for (const candidate of candidates) {
    const downloadUrl = imageUrls[candidate.imageRef];
    if (!downloadUrl) {
      throw new Error(`Figma images endpoint did not return a URL for imageRef ${candidate.imageRef}`);
    }

    const { buffer, mimeType } = await downloadBinary(fetchImpl, downloadUrl);
    const assetId = assetIdFor(candidate);
    const extension = extensionFor({ mimeType, url: downloadUrl });
    const relativePath = path.join("images", `${assetId}.${extension}`).replaceAll(path.sep, "/");
    await fs.writeFile(path.join(outputDir, relativePath), buffer);

    assets.push({
      assetId,
      kind: "image-fill",
      sourceNodeId: candidate.nodeId,
      sourceNodeName: candidate.nodeName,
      sourceBreakpoint: candidate.breakpoint,
      sourceSectionId: candidate.sectionId,
      figma: {
        fileKey: resolvedFileKey,
        nodeId: candidate.nodeId,
        imageRef: candidate.imageRef
      },
      path: relativePath,
      mimeType,
      sha256: sha256(buffer),
      usage: "shopify-file-upload"
    });
  }

  const manifest = {
    schemaVersion: "1.0.0",
    manifestType: "figma-assets-manifest",
    createdAt: now().toISOString(),
    producer: "figma-rest-asset-extractor",
    sourceManifestPath: sourceManifestLocation.relative,
    figma: {
      fileKey: resolvedFileKey,
      apiBase: cleanApiBase(apiBase)
    },
    assets
  };

  await fs.mkdir(outputDir, { recursive: true });
  await fs.writeFile(path.join(outputDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifest;
}

if (isMainModule(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      console.log(usage());
      process.exit(0);
    }

    if (!options.pageKey) {
      const resolved = resolvePageKey({ rootDir: options.rootDir });
      options.pageKey = resolved.pageKey;
      process.stderr.write(
        `extract-assets: resolved page-key "${options.pageKey}" from ${
          resolved.source === "branch" ? `git branch ${resolved.branch}` : "override"
        }\n`
      );
    }

    const manifest = await extractFigmaAssets(options);
    console.log(
      JSON.stringify(
        {
          ok: true,
          outputManifestPath: path.join(options.outputDir, "manifest.json"),
          assetCount: manifest.assets.length
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
