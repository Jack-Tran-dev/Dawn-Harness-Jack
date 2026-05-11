function isImageLikeNode(node) {
  if (!node || typeof node !== "object") {
    return false;
  }

  const name = typeof node.name === "string" ? node.name : "";
  if (/\b(image|photo|picture|media|logo)\b/i.test(name)) {
    return true;
  }

  const fills = Array.isArray(node.style?.fills) ? node.style.fills : [];
  return fills.some((fill) => String(fill?.type || "").toLowerCase() === "image");
}

function walkLayout(node, visit) {
  if (!node || typeof node !== "object") {
    return;
  }

  visit(node);

  for (const child of Array.isArray(node.children) ? node.children : []) {
    walkLayout(child, visit);
  }
}

function toPixelBox({ node, variant }) {
  const box = node.box;
  const canvasWidth = variant.canvas?.width;
  const canvasHeight = variant.canvas?.height;
  const previewWidth = variant.preview?.pixelWidth;
  const previewHeight = variant.preview?.pixelHeight;

  if (
    !box ||
    typeof canvasWidth !== "number" ||
    typeof canvasHeight !== "number" ||
    typeof previewWidth !== "number" ||
    typeof previewHeight !== "number" ||
    canvasWidth <= 0 ||
    canvasHeight <= 0
  ) {
    return null;
  }

  const scaleX = previewWidth / canvasWidth;
  const scaleY = previewHeight / canvasHeight;

  const rawLeft = Math.round(box.x * scaleX);
  const rawTop = Math.round(box.y * scaleY);
  const rawRight = Math.round((box.x + box.width) * scaleX);
  const rawBottom = Math.round((box.y + box.height) * scaleY);
  const left = Math.max(0, Math.min(previewWidth, rawLeft));
  const top = Math.max(0, Math.min(previewHeight, rawTop));
  const right = Math.max(0, Math.min(previewWidth, rawRight));
  const bottom = Math.max(0, Math.min(previewHeight, rawBottom));

  if (right <= left || bottom <= top) {
    return null;
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    wasClipped:
      left !== rawLeft ||
      top !== rawTop ||
      right !== rawRight ||
      bottom !== rawBottom
  };
}

function resolveLayoutNode(variant) {
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

export function buildFidelityEvidence({ fidelity, variant }) {
  if (fidelity?.mode !== "css-1-to-1") {
    return null;
  }

  const maskedRegions = [];
  let clippedMaskedRegionCount = 0;
  const layoutRoot = resolveLayoutNode(variant);

  if (fidelity.ignoreImageContent && layoutRoot) {
    walkLayout(layoutRoot, (node) => {
      if (!isImageLikeNode(node)) {
        return;
      }

      const pixelBox = toPixelBox({ node, variant });
      if (pixelBox && pixelBox.width > 0 && pixelBox.height > 0) {
        if (pixelBox.wasClipped) {
          clippedMaskedRegionCount += 1;
        }
        maskedRegions.push(pixelBox);
      }
    });
  }

  return {
    mode: "css-1-to-1",
    ignoreImageContent: fidelity.ignoreImageContent === true,
    maskedRegions,
    normalizedMaskedRegions: maskedRegions.map((region) => ({
      x: variant.preview?.pixelWidth ? region.x / variant.preview.pixelWidth : 0,
      y: variant.preview?.pixelHeight ? region.y / variant.preview.pixelHeight : 0,
      width: variant.preview?.pixelWidth ? region.width / variant.preview.pixelWidth : 0,
      height: variant.preview?.pixelHeight ? region.height / variant.preview.pixelHeight : 0
    })),
    diagnostics: {
      clippedMaskedRegionCount
    },
    comparison: {
      gridColumns: 24,
      gridRows: 24,
      maxStructuralDiffRatio: 0.025,
      maxAspectRatioDelta: 0.03
    }
  };
}
