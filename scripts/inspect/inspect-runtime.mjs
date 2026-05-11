import fs from "node:fs/promises";
import path from "node:path";

import { compileThemeStarter } from "../../harness/compiler/compile-theme-starter.mjs";
import { comparePngStructure } from "../../harness/runtime/compare-png-structure.mjs";
import { loadRuntimeProfile } from "../../harness/runtime/load-runtime-profile.mjs";
import { readPngSize } from "../../harness/runtime/read-png-size.mjs";
import { isMainModule } from "../../harness/shared/is-main-module.mjs";

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function emptyDiffStatuses() {
  return {
    matched: 0,
    missing: 0,
    "dimension-mismatch": 0,
    "fidelity-mismatch": 0
  };
}

function formatDiagnosisSummary(categories) {
  return categories
    .map((category) => category.replace(/-/g, " "))
    .join(", ");
}

function buildCaptureDiagnosis({ diffStatus, comparison, fidelityEvidence }) {
  if (diffStatus === "matched") {
    return {
      categories: [],
      severity: "info",
      summary: "Capture matched the expected runtime contract."
    };
  }

  if (diffStatus === "missing") {
    return {
      categories: ["missing-capture"],
      severity: "error",
      summary: "Expected runtime capture is missing."
    };
  }

  const categories = [];
  if (diffStatus === "dimension-mismatch" || comparison?.aspectRatioWithinTolerance === false) {
    categories.push("aspect-ratio");
  }
  if (
    diffStatus === "fidelity-mismatch" &&
    typeof comparison?.originOffset === "number" &&
    comparison.originOffset >= 0.08
  ) {
    categories.push("position-drift");
  }
  if (
    diffStatus === "fidelity-mismatch" &&
    typeof comparison?.coverageDelta === "number" &&
    comparison.coverageDelta >= 0.2
  ) {
    categories.push("scale-drift");
  }
  if (diffStatus === "fidelity-mismatch" && typeof comparison?.diffRatio === "number" && comparison.diffRatio > 0) {
    categories.push("structural-drift");
  }
  if ((fidelityEvidence?.diagnostics?.clippedMaskedRegionCount ?? 0) > 0) {
    categories.push("masked-region-overflow");
  }

  const uniqueCategories = [...new Set(categories)];
  if (uniqueCategories.length === 0) {
    uniqueCategories.push("structural-drift");
  }

  return {
    categories: uniqueCategories,
    severity: "error",
    summary: formatDiagnosisSummary(uniqueCategories)
  };
}

export async function inspectRuntime({
  rootDir,
  outputDir = path.join(rootDir, "starter", "theme")
}) {
  const generatedRuntimeProfilePath = path.join(outputDir, "runtime", "runtime-profile.json");
  if (!(await pathExists(generatedRuntimeProfilePath))) {
    await compileThemeStarter({ rootDir, outputDir });
  }
  const { runtimeProfilePath, runtimeProfile } = await loadRuntimeProfile({ outputDir });
  const pages = [];

  for (const page of runtimeProfile.pages) {
    let presentCaptureCount = 0;
    let missingCaptureCount = 0;
    const diffStatuses = emptyDiffStatuses();
    const captures = [];

    for (const capture of page.captures) {
      const captureFile = path.join(outputDir, capture.expectedCapturePath);
      const sourcePreviewFile = path.join(rootDir, capture.sourcePreviewPath);
      const present = await pathExists(captureFile);
      let diffStatus = "missing";
      let comparison = null;

      if (!present) {
        missingCaptureCount += 1;
        diffStatuses.missing += 1;
      } else {
        presentCaptureCount += 1;
        const [expectedSize, actualSize] = await Promise.all([
          readPngSize(sourcePreviewFile),
          readPngSize(captureFile)
        ]);

        if (capture.fidelityEvidence?.mode === "css-1-to-1") {
          comparison = await comparePngStructure({
            sourceFilePath: sourcePreviewFile,
            captureFilePath: captureFile,
            normalizedMaskedRegions: capture.fidelityEvidence.normalizedMaskedRegions ?? [],
            gridColumns: capture.fidelityEvidence.comparison?.gridColumns ?? 24,
            gridRows: capture.fidelityEvidence.comparison?.gridRows ?? 24,
            maxAspectRatioDelta: capture.fidelityEvidence.comparison?.maxAspectRatioDelta ?? 0.03
          });

          if (
            comparison.aspectRatioWithinTolerance &&
            comparison.diffRatio <= (capture.fidelityEvidence.comparison?.maxStructuralDiffRatio ?? 0.025)
          ) {
            diffStatus = "matched";
            diffStatuses.matched += 1;
          } else {
            diffStatus = "fidelity-mismatch";
            diffStatuses["fidelity-mismatch"] += 1;
          }
        } else if (expectedSize.width === actualSize.width && expectedSize.height === actualSize.height) {
          diffStatus = "matched";
          diffStatuses.matched += 1;
        } else {
          diffStatus = "dimension-mismatch";
          diffStatuses["dimension-mismatch"] += 1;
        }
      }

      captures.push({
        ...capture,
        diffStatus,
        present,
        comparison,
        diagnosis: buildCaptureDiagnosis({
          diffStatus,
          comparison,
          fidelityEvidence: capture.fidelityEvidence
        })
      });
    }

    pages.push({
      pageKey: page.pageKey,
      captureCount: page.captureCount,
      presentCaptureCount,
      missingCaptureCount,
      diffStatuses,
      captures
    });
  }

  return {
    rootDir,
    runtimeProfilePath,
    pageCount: runtimeProfile.pageCount,
    pages
  };
}

if (isMainModule(import.meta.url)) {
  const summary = await inspectRuntime({ rootDir: process.cwd() });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
