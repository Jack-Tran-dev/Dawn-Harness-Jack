import fs from "node:fs/promises";
import { decodePng } from "./png-codec.mjs";

function median(values) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middleIndex - 1] + sorted[middleIndex]) / 2;
  }

  return sorted[middleIndex];
}

function luminanceAt(png, x, y) {
  const offset = (png.width * y + x) << 2;
  const r = png.data[offset];
  const g = png.data[offset + 1];
  const b = png.data[offset + 2];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function isMaskedNormalized(x, y, width, height, normalizedMaskedRegions) {
  const xRatio = width > 0 ? (x + 0.5) / width : 0;
  const yRatio = height > 0 ? (y + 0.5) / height : 0;

  return normalizedMaskedRegions.some((region) =>
    xRatio >= region.x &&
    xRatio < region.x + region.width &&
    yRatio >= region.y &&
    yRatio < region.y + region.height
  );
}

function summarizeContentBounds(cellSummaries, { gridColumns, gridRows }) {
  const means = cellSummaries
    .map((cellSummary) => cellSummary.mean)
    .filter((mean) => Number.isFinite(mean));

  if (means.length === 0) {
    return {
      backgroundLuminance: 0,
      activeCellCount: 0,
      activeCellRatio: 0,
      activeBounds: null
    };
  }

  const backgroundLuminance = median(means);
  const deviationThreshold = 12;
  let minColumn = Infinity;
  let maxColumn = -1;
  let minRow = Infinity;
  let maxRow = -1;
  let activeCellCount = 0;

  for (const cellSummary of cellSummaries) {
    if (Math.abs(cellSummary.mean - backgroundLuminance) < deviationThreshold) {
      continue;
    }

    activeCellCount += 1;
    minColumn = Math.min(minColumn, cellSummary.column);
    maxColumn = Math.max(maxColumn, cellSummary.column);
    minRow = Math.min(minRow, cellSummary.row);
    maxRow = Math.max(maxRow, cellSummary.row);
  }

  const activeBounds = activeCellCount > 0
    ? {
      x: minColumn / gridColumns,
      y: minRow / gridRows,
      width: (maxColumn - minColumn + 1) / gridColumns,
      height: (maxRow - minRow + 1) / gridRows
    }
    : null;

  return {
    backgroundLuminance,
    activeCellCount,
    activeCellRatio: cellSummaries.length > 0 ? activeCellCount / cellSummaries.length : 0,
    activeBounds
  };
}

function buildContentAlignmentMetrics(sourceSummary, captureSummary) {
  if (!sourceSummary.activeBounds || !captureSummary.activeBounds) {
    return {
      originOffset: 0,
      horizontalOriginOffset: 0,
      verticalOriginOffset: 0,
      centerOffset: 0,
      horizontalCenterOffset: 0,
      verticalCenterOffset: 0,
      coverageDelta: 0
    };
  }

  const sourceCenterX = sourceSummary.activeBounds.x + (sourceSummary.activeBounds.width / 2);
  const sourceCenterY = sourceSummary.activeBounds.y + (sourceSummary.activeBounds.height / 2);
  const captureCenterX = captureSummary.activeBounds.x + (captureSummary.activeBounds.width / 2);
  const captureCenterY = captureSummary.activeBounds.y + (captureSummary.activeBounds.height / 2);
  const horizontalOriginOffset = Math.abs(sourceSummary.activeBounds.x - captureSummary.activeBounds.x);
  const verticalOriginOffset = Math.abs(sourceSummary.activeBounds.y - captureSummary.activeBounds.y);
  const originOffset = Math.sqrt((horizontalOriginOffset ** 2) + (verticalOriginOffset ** 2));
  const horizontalCenterOffset = Math.abs(sourceCenterX - captureCenterX);
  const verticalCenterOffset = Math.abs(sourceCenterY - captureCenterY);
  const centerOffset = Math.sqrt((horizontalCenterOffset ** 2) + (verticalCenterOffset ** 2));
  const sourceCoverage = sourceSummary.activeBounds.width * sourceSummary.activeBounds.height;
  const captureCoverage = captureSummary.activeBounds.width * captureSummary.activeBounds.height;
  const maxCoverage = Math.max(sourceCoverage, captureCoverage, 0.0001);
  const coverageDelta = Math.abs(sourceCoverage - captureCoverage) / maxCoverage;

  return {
    originOffset,
    horizontalOriginOffset,
    verticalOriginOffset,
    centerOffset,
    horizontalCenterOffset,
    verticalCenterOffset,
    coverageDelta
  };
}

export async function comparePngStructure({
  sourceFilePath,
  captureFilePath,
  normalizedMaskedRegions = [],
  gridColumns = 24,
  gridRows = 24,
  maxAspectRatioDelta = 0.03
}) {
  const [sourceBuffer, captureBuffer] = await Promise.all([
    fs.readFile(sourceFilePath),
    fs.readFile(captureFilePath)
  ]);
  const source = decodePng(sourceBuffer);
  const capture = decodePng(captureBuffer);

  const sourceAspectRatio = source.width / source.height;
  const captureAspectRatio = capture.width / capture.height;
  const aspectRatioDelta = Math.abs(sourceAspectRatio - captureAspectRatio) / sourceAspectRatio;
  const sourceColumnStep = source.width / gridColumns;
  const sourceRowStep = source.height / gridRows;
  const captureColumnStep = capture.width / gridColumns;
  const captureRowStep = capture.height / gridRows;
  let totalDifference = 0;
  let sampledCells = 0;
  const sourceCellSummaries = [];
  const captureCellSummaries = [];

  for (let row = 0; row < gridRows; row += 1) {
    const sourceStartY = Math.floor(row * sourceRowStep);
    const sourceEndY = Math.min(source.height, Math.floor((row + 1) * sourceRowStep) || source.height);
    const captureStartY = Math.floor(row * captureRowStep);
    const captureEndY = Math.min(capture.height, Math.floor((row + 1) * captureRowStep) || capture.height);

    for (let column = 0; column < gridColumns; column += 1) {
      const sourceStartX = Math.floor(column * sourceColumnStep);
      const sourceEndX = Math.min(source.width, Math.floor((column + 1) * sourceColumnStep) || source.width);
      const captureStartX = Math.floor(column * captureColumnStep);
      const captureEndX = Math.min(capture.width, Math.floor((column + 1) * captureColumnStep) || capture.width);
      let sourceSum = 0;
      let captureSum = 0;
      let sourceSamples = 0;
      let captureSamples = 0;

      for (let y = sourceStartY; y < sourceEndY; y += 1) {
        for (let x = sourceStartX; x < sourceEndX; x += 1) {
          if (isMaskedNormalized(x, y, source.width, source.height, normalizedMaskedRegions)) {
            continue;
          }

          sourceSum += luminanceAt(source, x, y);
          sourceSamples += 1;
        }
      }

      for (let y = captureStartY; y < captureEndY; y += 1) {
        for (let x = captureStartX; x < captureEndX; x += 1) {
          if (isMaskedNormalized(x, y, capture.width, capture.height, normalizedMaskedRegions)) {
            continue;
          }

          captureSum += luminanceAt(capture, x, y);
          captureSamples += 1;
        }
      }

      if (sourceSamples === 0 || captureSamples === 0) {
        continue;
      }

      const sourceMean = sourceSum / sourceSamples;
      const captureMean = captureSum / captureSamples;

      sourceCellSummaries.push({ row, column, mean: sourceMean });
      captureCellSummaries.push({ row, column, mean: captureMean });
      totalDifference += Math.abs(sourceMean - captureMean) / 255;
      sampledCells += 1;
    }
  }

  const sourceContent = summarizeContentBounds(sourceCellSummaries, { gridColumns, gridRows });
  const captureContent = summarizeContentBounds(captureCellSummaries, { gridColumns, gridRows });
  const alignment = buildContentAlignmentMetrics(sourceContent, captureContent);

  return {
    diffRatio: sampledCells > 0 ? totalDifference / sampledCells : 0,
    sampledCells,
    maskedRegionCount: normalizedMaskedRegions.length,
    aspectRatioDelta,
    aspectRatioWithinTolerance: aspectRatioDelta <= maxAspectRatioDelta,
    sourceContent,
    captureContent,
    originOffset: alignment.originOffset,
    horizontalOriginOffset: alignment.horizontalOriginOffset,
    verticalOriginOffset: alignment.verticalOriginOffset,
    centerOffset: alignment.centerOffset,
    horizontalCenterOffset: alignment.horizontalCenterOffset,
    verticalCenterOffset: alignment.verticalCenterOffset,
    coverageDelta: alignment.coverageDelta
  };
}
