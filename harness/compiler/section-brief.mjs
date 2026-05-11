import fs from "node:fs/promises";
import path from "node:path";

const ROUTE_SURFACE_TYPES = new Set(["page", "product", "cart"]);
const BUNDLE_CONSISTENCY_BLOCKING_CODES = new Set([
  "missing-detail",
  "missing-layout",
  "preview-detail-ratio-drift",
  "layout-box-out-of-bounds",
  "missing-asset-file"
]);

function dedupeStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeSnippet(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function isImageLikeNode(node) {
  if (!node || typeof node !== "object") {
    return false;
  }

  if (node.assetRef?.path) {
    return true;
  }

  const name = typeof node.name === "string" ? node.name : "";
  if (/\b(image|photo|picture|media|logo|background|container)\b/i.test(name)) {
    return true;
  }

  const fills = Array.isArray(node.style?.fills) ? node.style.fills : [];
  return fills.some((fill) => String(fill?.type || "").toLowerCase() === "image");
}

function isTextLikeNode(node) {
  if (!node || typeof node !== "object") {
    return false;
  }

  if (String(node.type || "").toUpperCase() === "TEXT") {
    return true;
  }

  return typeof node.characters === "string" || typeof node.text === "string";
}

function walk(node, visit, depth = 0) {
  if (!node || typeof node !== "object") {
    return;
  }

  visit(node, depth);

  for (const child of Array.isArray(node.children) ? node.children : []) {
    walk(child, visit, depth + 1);
  }
}

function resolveLayoutRoot(variant) {
  if (variant?.layout && typeof variant.layout === "object") {
    return variant.layout;
  }
  if (variant?.detail?.document?.layout && typeof variant.detail.document.layout === "object") {
    return variant.detail.document.layout;
  }
  if (variant?.detail?.document?.box && typeof variant.detail.document.box === "object") {
    return variant.detail.document;
  }

  return null;
}

function collectAssetRefs(node, assetRefs) {
  if (!node || typeof node !== "object") {
    return;
  }

  if (node.assetRef?.path) {
    assetRefs.push(node.assetRef.path);
  }
  for (const fill of Array.isArray(node.style?.fills) ? node.style.fills : []) {
    if (fill?.assetRef?.path) {
      assetRefs.push(fill.assetRef.path);
    }
  }
}

function buildRegion(node) {
  return {
    name: typeof node.name === "string" ? node.name : "node",
    x: typeof node.box?.x === "number" ? node.box.x : 0,
    y: typeof node.box?.y === "number" ? node.box.y : 0,
    width: typeof node.box?.width === "number" ? node.box.width : 0,
    height: typeof node.box?.height === "number" ? node.box.height : 0
  };
}

function regionArea(region) {
  return Math.max(0, region.width) * Math.max(0, region.height);
}

function sortRegionsByReadingOrder(regions) {
  return [...regions].sort((left, right) => {
    if (left.y !== right.y) {
      return left.y - right.y;
    }
    if (left.x !== right.x) {
      return left.x - right.x;
    }
    return regionArea(right) - regionArea(left);
  });
}

function buildUnionBox(regions) {
  if (!Array.isArray(regions) || regions.length === 0) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const region of regions) {
    minX = Math.min(minX, region.x);
    minY = Math.min(minY, region.y);
    maxX = Math.max(maxX, region.x + region.width);
    maxY = Math.max(maxY, region.y + region.height);
  }

  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY)
  };
}

function classifyPlacement(box, canvas) {
  if (!box || !canvas || canvas.width <= 0 || canvas.height <= 0) {
    return "none";
  }

  const widthRatio = box.width / canvas.width;
  const heightRatio = box.height / canvas.height;
  if (widthRatio >= 0.85 && heightRatio >= 0.85) {
    return "full-bleed";
  }

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const horizontalBias = (centerX - canvas.width / 2) / canvas.width;
  const verticalBias = (centerY - canvas.height / 2) / canvas.height;

  if (Math.abs(horizontalBias) >= Math.abs(verticalBias) && Math.abs(horizontalBias) > 0.1) {
    return horizontalBias < 0 ? "left" : "right";
  }

  if (Math.abs(verticalBias) > 0.1) {
    return verticalBias < 0 ? "top" : "bottom";
  }

  return "center";
}

function boxesOverlap(left, right) {
  if (!left || !right) {
    return false;
  }

  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

function inferLayoutPattern({ primaryTextBox, primaryImageBox, canvas }) {
  if (!primaryTextBox && !primaryImageBox) {
    return "unknown";
  }
  if (primaryTextBox && !primaryImageBox) {
    return "text-only";
  }
  if (!primaryTextBox && primaryImageBox) {
    return "image-only";
  }
  if (boxesOverlap(primaryTextBox, primaryImageBox)) {
    return "overlay";
  }

  const textPlacement = classifyPlacement(primaryTextBox, canvas);
  const imagePlacement = classifyPlacement(primaryImageBox, canvas);
  const splitPair =
    (textPlacement === "left" && imagePlacement === "right") ||
    (textPlacement === "right" && imagePlacement === "left");
  const stackedPair =
    (textPlacement === "top" && imagePlacement === "bottom") ||
    (textPlacement === "bottom" && imagePlacement === "top");

  if (splitPair) {
    return "split";
  }
  if (stackedPair) {
    return "stacked";
  }

  if (canvas?.width > 0 && canvas?.height > 0) {
    const horizontalGap = Math.abs(
      (primaryTextBox.x + primaryTextBox.width / 2) - (primaryImageBox.x + primaryImageBox.width / 2)
    );
    const verticalGap = Math.abs(
      (primaryTextBox.y + primaryTextBox.height / 2) - (primaryImageBox.y + primaryImageBox.height / 2)
    );
    if (horizontalGap > verticalGap) {
      return "split";
    }
    if (verticalGap > 0) {
      return "stacked";
    }
  }

  return "mixed";
}

function isLikelyCtaSnippet(value) {
  const normalized = normalizeSnippet(value).toLowerCase();
  if (!normalized) {
    return false;
  }

  const wordCount = normalized.split(/\s+/).length;
  if (wordCount > 5) {
    return false;
  }

  return /\b(shop|buy|learn|watch|get|start|explore|discover|read|view|try|order|see|join|book)\b/.test(
    normalized
  );
}

function buildContentSignals(textSnippets) {
  const ctaLabels = textSnippets.filter(isLikelyCtaSnippet);
  const nonCtaSnippets = textSnippets.filter((snippet) => !ctaLabels.includes(snippet));
  const primaryMessage = nonCtaSnippets[0] ?? textSnippets[0] ?? null;
  const supportingMessages = nonCtaSnippets.filter((snippet) => snippet !== primaryMessage);

  return {
    primaryMessage,
    supportingMessages,
    ctaLabels,
    callsToAction: ctaLabels
  };
}

function summarizeDataBinding(dataBinding) {
  if (!dataBinding) {
    return null;
  }
  if (dataBinding.kind === "product") {
    return {
      kind: "product",
      summary: `Bind to Shopify product '${dataBinding.handle}'.`
    };
  }
  if (dataBinding.kind === "collection") {
    return {
      kind: "collection",
      summary: `Bind to Shopify collection '${dataBinding.handle}'${dataBinding.limit ? ` with limit ${dataBinding.limit}` : ""}.`
    };
  }
  if (dataBinding.kind === "article") {
    return {
      kind: "article",
      summary: `Bind to Shopify blog '${dataBinding.blog}'${dataBinding.limit ? ` with limit ${dataBinding.limit}` : ""}.`
    };
  }
  if (dataBinding.kind === "metaobject") {
    return {
      kind: "metaobject",
      summary: `Bind to Shopify metaobject type '${dataBinding.type}'.`
    };
  }
  return null;
}

async function assetPathExists(rootDir, pageKey, relativeAssetPath) {
  try {
    await fs.access(path.join(rootDir, "figma", pageKey, relativeAssetPath));
    return true;
  } catch {
    return false;
  }
}

async function buildVariantSummary({ rootDir, pageKey, breakpoint, variant }) {
  const layoutRoot = resolveLayoutRoot(variant);
  const previewWidth = variant?.preview?.pixelWidth ?? 0;
  const previewHeight = variant?.preview?.pixelHeight ?? 0;
  const canvasWidth = variant?.canvas?.width ?? previewWidth;
  const canvasHeight = variant?.canvas?.height ?? previewHeight;
  const textRegions = [];
  const imageRegions = [];
  const assetPaths = [];
  let textNodeCount = 0;
  let imageNodeCount = 0;

  if (layoutRoot) {
    walk(layoutRoot, (node) => {
      collectAssetRefs(node, assetPaths);
      if (isTextLikeNode(node)) {
        textNodeCount += 1;
        textRegions.push(buildRegion(node));
      }
      if (isImageLikeNode(node)) {
        imageNodeCount += 1;
        imageRegions.push({
          ...buildRegion(node),
          assetPath: node.assetRef?.path ?? null
        });
      }
    });
  }

  const diagnostics = [];
  if (!variant?.detail) {
    diagnostics.push({
      code: "missing-detail",
      severity: "warning",
      message: `${breakpoint} variant does not provide a detail document.`,
      breakpoint
    });
  } else if (!layoutRoot) {
    diagnostics.push({
      code: "missing-layout",
      severity: "warning",
      message: `${breakpoint} detail document does not expose a layout tree.`,
      breakpoint
    });
  }

  if (canvasWidth > 0 && canvasHeight > 0 && previewWidth > 0 && previewHeight > 0) {
    const canvasRatio = canvasWidth / canvasHeight;
    const previewRatio = previewWidth / previewHeight;
    const ratioDelta = Math.abs(canvasRatio - previewRatio) / canvasRatio;
    if (ratioDelta > 0.03) {
      diagnostics.push({
        code: "preview-detail-ratio-drift",
        severity: "warning",
        message: `${breakpoint} canvas ratio drifts from preview ratio by ${ratioDelta.toFixed(4)}.`,
        breakpoint
      });
    }
  }

  for (const region of [...textRegions, ...imageRegions]) {
    if (
      previewWidth > 0 &&
      previewHeight > 0 &&
      (
        region.x < 0 ||
        region.y < 0 ||
        region.x + region.width > canvasWidth ||
        region.y + region.height > canvasHeight
      )
    ) {
      diagnostics.push({
        code: "layout-box-out-of-bounds",
        severity: "warning",
        message: `${breakpoint} layout contains node regions that extend outside the declared canvas.`,
        breakpoint
      });
      break;
    }
  }

  for (const assetPath of dedupeStrings(assetPaths)) {
    if (!(await assetPathExists(rootDir, pageKey, assetPath))) {
      diagnostics.push({
        code: "missing-asset-file",
        severity: "warning",
        message: `${breakpoint} detail references missing asset ${assetPath}.`,
        breakpoint
      });
    }
  }

  return {
    preview: {
      path: variant?.preview?.relativePath ?? "",
      pixelWidth: previewWidth,
      pixelHeight: previewHeight
    },
    canvas: {
      width: canvasWidth,
      height: canvasHeight
    },
    rootNodeType: String(layoutRoot?.type || variant?.type || "unknown"),
    textNodeCount,
    imageNodeCount,
    readingOrderTextRegions: sortRegionsByReadingOrder(textRegions).slice(0, 5),
    topTextRegions: textRegions
      .sort((left, right) => regionArea(right) - regionArea(left))
      .slice(0, 3),
    topImageRegions: imageRegions
      .sort((left, right) => regionArea(right) - regionArea(left))
      .slice(0, 3),
    primaryTextBox: buildUnionBox(textRegions),
    primaryImageBox: buildUnionBox(imageRegions),
    dominantTextPlacement: classifyPlacement(buildUnionBox(textRegions), { width: canvasWidth, height: canvasHeight }),
    dominantImagePlacement: classifyPlacement(buildUnionBox(imageRegions), { width: canvasWidth, height: canvasHeight }),
    layoutPattern: inferLayoutPattern({
      primaryTextBox: buildUnionBox(textRegions),
      primaryImageBox: buildUnionBox(imageRegions),
      canvas: { width: canvasWidth, height: canvasHeight }
    }),
    assetPaths: dedupeStrings(assetPaths),
    diagnostics
  };
}

async function analyzeSectionInputs({ rootDir, pageKey, section }) {
  const desktop = await buildVariantSummary({
    rootDir,
    pageKey,
    breakpoint: "desktop",
    variant: section.variants.desktop
  });
  const mobile = await buildVariantSummary({
    rootDir,
    pageKey,
    breakpoint: "mobile",
    variant: section.variants.mobile
  });
  const diagnostics = [...desktop.diagnostics, ...mobile.diagnostics];

  return {
    desktop,
    mobile,
    diagnostics
  };
}

export async function buildBundleConsistency({ rootDir, pageKey, surfaceType, sections }) {
  const issues = [];
  const sectionSummaries = [];
  const routeOwned = ROUTE_SURFACE_TYPES.has(surfaceType);

  for (const section of sections ?? []) {
    const analysis = await analyzeSectionInputs({ rootDir, pageKey, section });
    const sectionIssues = analysis.diagnostics.map((diagnostic) => ({
      sectionId: section.id,
      breakpoint: diagnostic.breakpoint ?? null,
      code: diagnostic.code,
      severity:
        routeOwned && BUNDLE_CONSISTENCY_BLOCKING_CODES.has(diagnostic.code)
          ? "error"
          : diagnostic.severity === "error"
            ? "error"
            : "warning",
      message: diagnostic.message
    }));

    issues.push(...sectionIssues);
    sectionSummaries.push({
      sectionId: section.id,
      issueCount: sectionIssues.length,
      issues: sectionIssues
    });
  }

  const blockingIssueCount = issues.filter((issue) => issue.severity === "error").length;
  const warningIssueCount = issues.filter((issue) => issue.severity !== "error").length;

  return {
    status: blockingIssueCount > 0 ? "blocked" : warningIssueCount > 0 ? "warning" : "passed",
    blockingIssueCount,
    warningIssueCount,
    issues,
    sections: sectionSummaries
  };
}

export async function buildSectionBrief({ rootDir, pageKey, section }) {
  const textSnippets = dedupeStrings((section.textDefaults ?? []).map(normalizeSnippet));
  const contentSignals = buildContentSignals(textSnippets);
  const analysis = await analyzeSectionInputs({ rootDir, pageKey, section });
  const desktopFigmaSource = section.source?.desktop?.figma ?? section.variants.desktop?.source?.figma;
  const mobileFigmaSource = section.source?.mobile?.figma ?? section.variants.mobile?.source?.figma;
  const figmaSource = {
    ...(desktopFigmaSource ? { desktop: desktopFigmaSource } : {}),
    ...(mobileFigmaSource ? { mobile: mobileFigmaSource } : {})
  };
  const dataBinding = summarizeDataBinding(section.dataBinding);

  return {
    goal:
      section.implementationPolicy?.pattern === "carousel"
        ? `Restore the ${section.name} carousel section with faithful desktop and mobile structure.`
        : `Restore the ${section.name} section with faithful desktop and mobile structure.`,
    content: {
      textSnippets,
      primaryMessage: contentSignals.primaryMessage,
      supportingMessages: contentSignals.supportingMessages,
      imageAssetPaths: dedupeStrings([...analysis.desktop.assetPaths, ...analysis.mobile.assetPaths]),
      ...(dataBinding ? { dataBinding } : {}),
      callsToAction: contentSignals.callsToAction,
      ctaLabels: contentSignals.ctaLabels
    },
    layout: {
      desktop: analysis.desktop,
      mobile: analysis.mobile
    },
    ...(Object.keys(figmaSource).length > 0 ? { source: { figma: figmaSource } } : {}),
    diagnostics: analysis.diagnostics
  };
}
