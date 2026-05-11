import fs from "node:fs/promises";
import path from "node:path";
import { buildBundleConsistency } from "./section-brief.mjs";

const BREAKPOINTS = ["desktop", "mobile"];
const DEFAULT_SURFACE_TYPE = "page";
const DEFAULT_IMPLEMENTATION_POLICY = Object.freeze({
  pattern: "static",
  repeatedContentSource: "settings",
  defaultImplementation: "none",
  allowedImplementationExceptions: [],
  themeCodeReuse: "avoid"
});
const DEFAULT_FIDELITY = Object.freeze({
  mode: "standard",
  ignoreImageContent: false,
  requireExplicitLayoutReview: false
});

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function dedupeStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function isRouteOwnedSurface(surfaceType) {
  return surfaceType === "page" || surfaceType === "product" || surfaceType === "cart";
}

function buildSectionHandle(sectionVariants) {
  return (
    sectionVariants.desktop?.summary?.suggestedHandle ||
    sectionVariants.mobile?.summary?.suggestedHandle ||
    sectionVariants.desktop?.name ||
    sectionVariants.mobile?.name ||
    "section"
  );
}

function isWeakHandle(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return true;
  }

  return /^(background|frame(?:-\d+)?|group(?:-\d+)?|rectangle(?:-\d+)?|container(?:-\d+)?)$/i.test(
    value.trim()
  );
}

function isWeakNodeName(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }

  return /^(background|frame(?:\s+\d+)?|group(?:\s+\d+)?|rectangle(?:\s+\d+)?|container)$/i.test(
    value.trim()
  );
}

function normalizeSnippet(text) {
  return text.replace(/\s+/g, " ").trim();
}

function collectSuggestedTextDefaults(sectionVariants) {
  const snippets = [];

  for (const variant of Object.values(sectionVariants)) {
    const values = variant?.summary?.textSnippets ?? [];
    for (const value of values) {
      const normalized = normalizeSnippet(value);
      if (normalized) {
        snippets.push(normalized);
      }
    }
  }

  return dedupeStrings(snippets).slice(0, 4);
}

function inferImplementationHints(pageSection, sectionVariants) {
  const names = [
    pageSection?.name,
    pageSection?.source?.desktop?.nodeName,
    pageSection?.source?.mobile?.nodeName,
    sectionVariants.desktop?.name,
    sectionVariants.mobile?.name,
    sectionVariants.desktop?.source?.nodeName,
    sectionVariants.mobile?.source?.nodeName
  ]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());

  const carouselPattern = /\b(slideshow|slider|carousel)\b/;
  if (names.some((value) => carouselPattern.test(value))) {
    return {
      pattern: "carousel"
    };
  }

  return null;
}

function normalizeImplementationPolicy(implementationHints, pageSection, sectionVariants) {
  const effectiveHints =
    implementationHints && typeof implementationHints === "object"
      ? implementationHints
      : inferImplementationHints(pageSection, sectionVariants);

  if (!effectiveHints || typeof effectiveHints !== "object") {
    return { ...DEFAULT_IMPLEMENTATION_POLICY };
  }

  const pattern = effectiveHints.pattern === "carousel" ? "carousel" : DEFAULT_IMPLEMENTATION_POLICY.pattern;

  if (pattern === "carousel") {
    return {
      pattern,
      repeatedContentSource:
        effectiveHints.repeatedContentSource === "settings" ? "settings" : "blocks",
      defaultImplementation:
        effectiveHints.defaultImplementation === "scroll-snap" ? "scroll-snap" : "swiper",
      allowedImplementationExceptions: Array.isArray(effectiveHints.allowedImplementationExceptions)
        ? dedupeStrings(
          effectiveHints.allowedImplementationExceptions.filter((value) => value === "scroll-snap")
        )
        : ["scroll-snap"],
      themeCodeReuse: effectiveHints.themeCodeReuse === "allow" ? "allow" : "avoid"
    };
  }

  return {
    pattern,
    repeatedContentSource:
      effectiveHints.repeatedContentSource === "blocks" ? "blocks" : DEFAULT_IMPLEMENTATION_POLICY.repeatedContentSource,
    defaultImplementation:
      effectiveHints.defaultImplementation === "scroll-snap" ? "scroll-snap" : DEFAULT_IMPLEMENTATION_POLICY.defaultImplementation,
    allowedImplementationExceptions: Array.isArray(effectiveHints.allowedImplementationExceptions)
      ? dedupeStrings(
        effectiveHints.allowedImplementationExceptions.filter((value) => value === "scroll-snap")
      )
      : [],
    themeCodeReuse: effectiveHints.themeCodeReuse === "allow" ? "allow" : "avoid"
  };
}

function normalizeFidelity(fidelity, surfaceType) {
  if (isRouteOwnedSurface(surfaceType)) {
    return {
      mode: "css-1-to-1",
      ignoreImageContent:
        typeof fidelity?.ignoreImageContent === "boolean" ? fidelity.ignoreImageContent : true,
      requireExplicitLayoutReview:
        typeof fidelity?.requireExplicitLayoutReview === "boolean"
          ? fidelity.requireExplicitLayoutReview
          : false
    };
  }

  if (!fidelity || typeof fidelity !== "object") {
    return { ...DEFAULT_FIDELITY };
  }

  const mode = fidelity.mode === "css-1-to-1" ? "css-1-to-1" : DEFAULT_FIDELITY.mode;

  return {
    mode,
    ignoreImageContent:
      typeof fidelity.ignoreImageContent === "boolean"
        ? fidelity.ignoreImageContent
        : mode === "css-1-to-1",
    requireExplicitLayoutReview:
      typeof fidelity.requireExplicitLayoutReview === "boolean"
        ? fidelity.requireExplicitLayoutReview
        : mode === "css-1-to-1"
  };
}

function buildBundleQuality({ page, surfaceType, sections }) {
  const issues = [];

  if (isRouteOwnedSurface(surfaceType)) {
    if (page?.pairingMode === "order-fallback") {
      issues.push(`page pairingMode ${page.pairingMode} is not eligible for one-shot route generation`);
    }

    if (page?.pairingConfidence && page.pairingConfidence !== "high") {
      issues.push(`page pairingConfidence ${page.pairingConfidence} is below the required high threshold`);
    }

    for (const section of sections) {
      if (isWeakHandle(section.handle)) {
        issues.push(`section ${section.id} compiled to weak section handle ${section.handle}`);
      }

      const desktopNodeName = section.source?.desktop?.nodeName;
      const mobileNodeName = section.source?.mobile?.nodeName;
      if (isWeakNodeName(desktopNodeName) && isWeakNodeName(mobileNodeName)) {
        issues.push(
          `section ${section.id} uses weak source node names (${desktopNodeName ?? "unknown"} / ${mobileNodeName ?? "unknown"})`
        );
      }
    }
  }

  return {
    status: issues.length > 0 ? "blocked" : "passed",
    oneShotEligible: issues.length === 0,
    issues
  };
}

function sectionFileParts(fileName) {
  const match = /^(section-\d+)\.(desktop|mobile)\.json$/.exec(fileName);
  if (!match) {
    return null;
  }

  return {
    id: match[1],
    breakpoint: match[2]
  };
}

function normalizeVariantPreview(variant, { pageKey, fileName }) {
  if (variant?.preview && typeof variant.preview === "object" && typeof variant.preview.path === "string") {
    return { ...variant.preview };
  }

  const resourcePreviews = Array.isArray(variant?.resources?.previews)
    ? variant.resources.previews.filter((preview) => preview && typeof preview.path === "string")
    : [];

  if (resourcePreviews.length === 1) {
    return { ...resourcePreviews[0] };
  }

  if (resourcePreviews.length > 1) {
    throw new Error(
      `Expected exactly one preview entry for ${pageKey}/${fileName}, received ${resourcePreviews.length}`
    );
  }

  throw new Error(`Missing preview metadata for ${pageKey}/${fileName}`);
}

function normalizeVariantDetail(variant) {
  if (typeof variant?.detailPath !== "string") {
    return null;
  }

  const detailPath = variant.detailPath.trim();
  return detailPath.length > 0 ? detailPath : null;
}

function normalizeImplementationFamily(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  if (typeof value.key !== "string" || value.key.trim().length === 0) {
    return null;
  }

  if (value.basis !== "explicit-section-id") {
    return null;
  }

  if (!["high", "medium", "low"].includes(value.confidence)) {
    return null;
  }

  return {
    key: value.key.trim(),
    basis: value.basis,
    confidence: value.confidence
  };
}

function resolveImplementationFamily(desktopVariant, mobileVariant) {
  const desktopFamily = normalizeImplementationFamily(
    desktopVariant?.summary?.implementationFamily
  );
  const mobileFamily = normalizeImplementationFamily(
    mobileVariant?.summary?.implementationFamily
  );

  if (!desktopFamily || !mobileFamily) {
    return null;
  }

  if (
    desktopFamily.key !== mobileFamily.key ||
    desktopFamily.basis !== mobileFamily.basis ||
    desktopFamily.confidence !== mobileFamily.confidence
  ) {
    return null;
  }

  return desktopFamily;
}

function normalizeDataBinding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  if (value.kind === "product" && typeof value.handle === "string" && value.handle.trim()) {
    return {
      kind: "product",
      handle: value.handle.trim()
    };
  }

  if (value.kind === "collection" && typeof value.handle === "string" && value.handle.trim()) {
    return {
      kind: "collection",
      handle: value.handle.trim(),
      ...(typeof value.limit === "number" ? { limit: value.limit } : {})
    };
  }

  if (value.kind === "article" && typeof value.blog === "string" && value.blog.trim()) {
    return {
      kind: "article",
      blog: value.blog.trim(),
      ...(typeof value.limit === "number" ? { limit: value.limit } : {})
    };
  }

  if (value.kind === "metaobject" && typeof value.type === "string" && value.type.trim()) {
    return {
      kind: "metaobject",
      type: value.type.trim()
    };
  }

  return null;
}

function resolveDataBinding(desktopVariant, mobileVariant, { pageKey, sectionId }) {
  const desktopBinding = normalizeDataBinding(desktopVariant?.summary?.dataBinding);
  const mobileBinding = normalizeDataBinding(mobileVariant?.summary?.dataBinding);

  if (!desktopBinding && !mobileBinding) {
    return null;
  }

  if (!desktopBinding || !mobileBinding) {
    throw new Error(`Mismatched data binding breakpoints for ${pageKey}/${sectionId}`);
  }

  if (JSON.stringify(desktopBinding) !== JSON.stringify(mobileBinding)) {
    throw new Error(`Mismatched data binding values for ${pageKey}/${sectionId}`);
  }

  return desktopBinding;
}

function normalizeSectionExecution(sectionExecution, { pageKey, sectionIds }) {
  const availableSectionIds = Array.isArray(sectionIds) ? sectionIds : [];
  const excludeSectionIds = dedupeStrings(
    Array.isArray(sectionExecution?.excludeSectionIds) ? sectionExecution.excludeSectionIds.map((value) => String(value).trim()) : []
  );
  const unknownSectionIds = excludeSectionIds.filter((sectionId) => !availableSectionIds.includes(sectionId));

  if (unknownSectionIds.length > 0) {
    throw new Error(
      `Unknown excluded section id(s) for ${pageKey}: ${unknownSectionIds.join(", ")}`
    );
  }

  return {
    excludeSectionIds,
    sourceSectionCount: availableSectionIds.length,
    activeSectionCount: availableSectionIds.filter((sectionId) => !excludeSectionIds.includes(sectionId)).length
  };
}

export async function discoverFigmaPageBundles({ rootDir }) {
  const figmaDir = path.join(rootDir, "figma");
  if (!(await pathExists(figmaDir))) {
    return [];
  }
  const entries = await fs.readdir(figmaDir, { withFileTypes: true });
  const bundles = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const pagePath = path.join(figmaDir, entry.name);
    const pageJsonPath = path.join(pagePath, "page.json");
    if (!(await pathExists(pageJsonPath))) {
      continue;
    }

    bundles.push({
      pageKey: entry.name,
      pagePath: path.posix.join("figma", entry.name),
      pageJsonPath
    });
  }

  bundles.sort((left, right) => left.pageKey.localeCompare(right.pageKey));
  return bundles;
}

export async function loadFigmaPageBundle({ rootDir, pageKey }) {
  const pageDir = path.join(rootDir, "figma", pageKey);
  const pageJsonPath = path.join(pageDir, "page.json");
  const page = await readJson(pageJsonPath);
  const surfaceType = page.surfaceType ?? DEFAULT_SURFACE_TYPE;
  const sharedSurfaceKeys = Array.isArray(page.sharedSurfaceKeys) ? page.sharedSurfaceKeys : [];
  const pageSectionIds = Array.isArray(page.sectionIds) ? page.sectionIds : [];
  const sectionExecution = normalizeSectionExecution(page.sectionExecution, {
    pageKey,
    sectionIds: pageSectionIds
  });
  const excludedSectionIds = new Set(sectionExecution.excludeSectionIds);
  const designSystem = page.designSystem ?? null;
  const fidelity = normalizeFidelity(page.fidelity, surfaceType);
  const sectionDir = path.join(pageDir, "sections");
  const sectionFiles = await fs.readdir(sectionDir);
  const sectionMap = new Map();
  const previewCountByBreakpoint = { desktop: 0, mobile: 0 };

  for (const fileName of sectionFiles) {
    const parts = sectionFileParts(fileName);
    if (!parts) {
      continue;
    }

    const sectionPath = path.join(sectionDir, fileName);
    const variant = await readJson(sectionPath);
    const preview = normalizeVariantPreview(variant, { pageKey, fileName });
    const previewPath = path.join(pageDir, preview.path);
    const detailPath = normalizeVariantDetail(variant);

    if (!(await pathExists(previewPath))) {
      throw new Error(`Missing preview for ${pageKey}/${fileName}: ${preview.path}`);
    }

    let detail = null;
    if (detailPath) {
      const absoluteDetailPath = path.join(pageDir, detailPath);
      if (!(await pathExists(absoluteDetailPath))) {
        throw new Error(`Missing detail document for ${pageKey}/${fileName}: ${detailPath}`);
      }

      const detailDocument = await readJson(absoluteDetailPath);

      detail = {
        path: detailPath,
        absolutePath: absoluteDetailPath,
        relativePath: path.posix.join("figma", pageKey, detailPath),
        document: detailDocument
      };
    }
    if (!sectionMap.has(parts.id)) {
      sectionMap.set(parts.id, {});
    }

    sectionMap.get(parts.id)[parts.breakpoint] = {
      ...variant,
      preview: {
        ...preview,
        absolutePath: previewPath,
        relativePath: path.posix.join("figma", pageKey, preview.path)
      },
      ...(detail ? { detail } : {})
    };
  }

  const sections = [];
  const sectionCountByBreakpoint = { desktop: 0, mobile: 0 };

  for (const sectionId of pageSectionIds) {
    if (excludedSectionIds.has(sectionId)) {
      continue;
    }

    const variants = sectionMap.get(sectionId);
    if (!variants) {
      throw new Error(`Missing section variants for ${pageKey}/${sectionId}`);
    }

    for (const breakpoint of BREAKPOINTS) {
      if (!variants[breakpoint]) {
        throw new Error(`Missing ${breakpoint} variant for ${pageKey}/${sectionId}`);
      }

      sectionCountByBreakpoint[breakpoint] += 1;
      previewCountByBreakpoint[breakpoint] += 1;
    }

    const desktopVariant = variants.desktop;
    const mobileVariant = variants.mobile;
    const pageSection = page.sections.find((section) => section.id === sectionId);

    sections.push({
      id: sectionId,
      pageKey,
      name: pageSection?.name || desktopVariant.name || mobileVariant.name,
      slotIndex: pageSection?.slotIndex || desktopVariant.slotIndex,
      handle: buildSectionHandle(variants),
      implementationFamily: resolveImplementationFamily(desktopVariant, mobileVariant) ?? undefined,
      desktopDetailPath: desktopVariant.detail?.relativePath,
      mobileDetailPath: mobileVariant.detail?.relativePath,
      textDefaults: collectSuggestedTextDefaults(variants),
      dataBinding: resolveDataBinding(desktopVariant, mobileVariant, { pageKey, sectionId }) ?? undefined,
      implementationPolicy: normalizeImplementationPolicy(pageSection?.implementationHints, pageSection, variants),
      source: pageSection?.source || {
        desktop: desktopVariant.source,
        mobile: mobileVariant.source
      },
      variants
    });
  }

  const bundleQuality = buildBundleQuality({ page, surfaceType, sections });
  const bundleConsistency = await buildBundleConsistency({ rootDir, pageKey, surfaceType, sections });

  return {
    pageKey,
    pagePath: path.posix.join("figma", pageKey),
    page: {
      ...page,
      designSystem,
      fidelity,
      surfaceType,
      sharedSurfaceKeys,
      sectionExecution: {
        excludeSectionIds: sectionExecution.excludeSectionIds
      }
    },
    designSystem,
    fidelity,
    surfaceType,
    sharedSurfaceKeys,
    bundleQuality,
    bundleConsistency,
    sectionExecution,
    sections,
    sectionCountByBreakpoint,
    previewCountByBreakpoint
  };
}
