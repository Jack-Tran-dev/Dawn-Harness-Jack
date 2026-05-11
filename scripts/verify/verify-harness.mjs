import fs from "node:fs/promises";
import path from "node:path";

import { compileThemeStarter } from "../../harness/compiler/compile-theme-starter.mjs";
import { isMainModule } from "../../harness/shared/is-main-module.mjs";
import { inspectHarness } from "../inspect/inspect-harness.mjs";

async function ensureFile(filePath) {
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`Missing required file: ${filePath}`);
  }
}

export async function verifyHarness({
  rootDir,
  outputDir = path.join(rootDir, "starter", "theme")
}) {
  const contractPaths = [
    path.join(rootDir, "harness", "contracts", "agent-tools-config.schema.json"),
    path.join(rootDir, "harness", "contracts", "figma-assets-manifest.schema.json"),
    path.join(rootDir, "harness", "contracts", "figma-page-bundle.schema.json"),
    path.join(rootDir, "harness", "contracts", "figma-source-manifest.schema.json"),
    path.join(rootDir, "harness", "contracts", "starter-review-manifest.schema.json")
  ];

  for (const contractPath of contractPaths) {
    await ensureFile(contractPath);
  }

  const compileSummary = await compileThemeStarter({ rootDir, outputDir });
  const inspectSummary = await inspectHarness({ rootDir, outputDir });

  const generatedSectionCount = inspectSummary.pages.reduce(
    (count, page) => count + page.generated.sections,
    0
  );
  const generatedTemplateCount = inspectSummary.pages.filter((page) => page.generated.template).length;
  const generatedManifestCount = inspectSummary.pages.filter((page) => page.generated.reviewManifest).length;
  const parityIssues = inspectSummary.pages
    .filter((page) => page.designSystem?.parity)
    .filter((page) => page.designSystem.parity.status !== "matched" && page.designSystem.parity.status !== "unspecified")
    .map((page) => ({
      pageKey: page.pageKey,
      reason: page.designSystem.parity.reason
    }));
  const bundleQualityIssues = inspectSummary.pages
    .filter((page) => page.bundleQuality && page.bundleQuality.oneShotEligible === false)
    .map((page) => ({
      pageKey: page.pageKey,
      issues: page.bundleQuality.issues
    }));
  const bundleConsistencyIssues = inspectSummary.pages
    .filter((page) => page.bundleConsistency?.status === "blocked")
    .map((page) => ({
      pageKey: page.pageKey,
      issues: page.bundleConsistency.issues.map((issue) => issue.message)
    }));

  const ok = inspectSummary.pages.length > 0 && inspectSummary.pages.every(
    (page) =>
      page.sections > 0 &&
      page.generated.sections === page.sections &&
      page.generated.template &&
      page.generated.reviewManifest &&
      page.generated.capturePlan
  );

  if (!ok) {
    if (inspectSummary.pages.length === 0) {
      throw new Error("Harness verification failed: at least one Figma page bundle is required");
    }
    throw new Error("Harness verification failed: starter outputs are incomplete");
  }

  if (parityIssues.length > 0) {
    throw new Error(
      `Harness verification failed: Kik token-source parity mismatch (${parityIssues
        .map((issue) => `${issue.pageKey}: ${issue.reason}`)
        .join("; ")})`
    );
  }

  if (bundleQualityIssues.length > 0) {
    throw new Error(
      `Harness verification failed: route bundle quality gate blocked one-shot generation (${bundleQualityIssues
        .map((issue) => `${issue.pageKey}: ${issue.issues.join(", ")}`)
        .join("; ")})`
    );
  }

  if (bundleConsistencyIssues.length > 0) {
    throw new Error(
      `Harness verification failed: route bundle consistency diagnosis blocked one-shot generation (${bundleConsistencyIssues
        .map((issue) => `${issue.pageKey}: ${issue.issues.join(", ")}`)
        .join("; ")})`
    );
  }

  if (inspectSummary.legacySourceManifest) {
    throw new Error(
      `Harness verification failed: ${inspectSummary.legacySourceManifest.message}`
    );
  }

  return {
    ok,
    pageCount: compileSummary.pages.length,
    generatedSectionCount,
    generatedTemplateCount,
    generatedManifestCount
  };
}

if (isMainModule(import.meta.url)) {
  try {
    const summary = await verifyHarness({ rootDir: process.cwd() });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
