import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

import { isMainModule } from "../../harness/shared/is-main-module.mjs";
import {
  getSectionResultPolicyErrorWithNotes,
  getSectionResultShapeError
} from "./section-result-validation.mjs";
import { sectionImplementationArtifactRelativePath } from "../verify/verify-section-implementation.mjs";
import {
  readRetryLedger,
  updateRetryLedger,
  writeRetryLedger
} from "../../harness/shared/retry-ledger.mjs";

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function resolvePreviewVerified({ outputDir, pageKey, explicitPreviewVerified }) {
  if (explicitPreviewVerified) {
    return true;
  }

  try {
    const previewResult = await readJson(path.join(outputDir, "agent", `page.${pageKey}.preview.json`));
    return previewResult?.status === "passed";
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function resolveSectionImplementationVerification({
  outputDir,
  pageKey
}) {
  try {
    const implementationResult = await readJson(
      path.join(outputDir, sectionImplementationArtifactRelativePath(pageKey))
    );
    return {
      verified: implementationResult?.status === "passed",
      blockedSections: Array.isArray(implementationResult?.blockedSections)
        ? implementationResult.blockedSections
        : [],
      openIssues: Array.isArray(implementationResult?.openIssues)
        ? implementationResult.openIssues
        : implementationResult?.status === "passed"
          ? []
          : ["section implementation verification has not passed"]
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        verified: false,
        blockedSections: [],
        openIssues: ["section implementation verification has not been marked complete"]
      };
    }
    throw error;
  }
}

function sectionResultsRequireLayoutReview(sectionResults) {
  return sectionResults.some((result) =>
    Array.isArray(result.needsMainAgentVerification) &&
    result.needsMainAgentVerification.includes("page_level_layout_review")
  );
}

function buildCommandsRun({
  pageTaskPath,
  surfaceType,
  previewVerified,
  sectionImplementationVerified,
  layoutReviewPassed,
  themeCheckPassed,
  runtimeInspectPassed,
  runtimeVerifyPassed
}) {
  const commands = [`build-page-verification ${pageTaskPath}`];
  if (surfaceType === "global") {
    commands.push("global surface verification delegated to consuming routes");
    return commands;
  }
  if (previewVerified) {
    commands.push("preview verified");
  }
  if (sectionImplementationVerified) {
    commands.push("section implementation verified");
  }
  if (layoutReviewPassed) {
    commands.push("layout review passed");
  }
  if (themeCheckPassed) {
    commands.push("theme check passed");
  }
  if (runtimeInspectPassed) {
    commands.push("runtime inspect passed");
  }
  if (runtimeVerifyPassed) {
    commands.push("runtime verify passed");
  }
  return commands;
}

function fingerprintResult(result) {
  return createHash("sha256").update(JSON.stringify(result)).digest("hex");
}

export async function buildPageVerification({
  outputDir,
  pageTaskPath,
  rootDir,
  previewVerified = false,
  sectionImplementationVerified = false,
  layoutReviewPassed = false,
  themeCheckPassed = false,
  runtimeInspectPassed = false,
  runtimeVerifyPassed = false
}) {
  const pageTask = await readJson(pageTaskPath);
  const resolvedPreviewVerified = await resolvePreviewVerified({
    outputDir,
    pageKey: pageTask.pageKey,
    explicitPreviewVerified: previewVerified
  });
  const resolvedSectionImplementation = await resolveSectionImplementationVerification({
    outputDir,
    pageKey: pageTask.pageKey
  });
  const openIssues = [];
  const blockedSectionEntries = new Map();
  const sectionResults = [];
  const collectedSectionResults = [];
  const isGlobalSurface = pageTask.surfaceType === "global";

  function blockSection(sectionId, message, fingerprint = null) {
    const existing = blockedSectionEntries.get(sectionId) ?? {
      sectionId,
      openIssues: [],
      fingerprint
    };
    existing.openIssues.push(message);
    existing.fingerprint = existing.fingerprint ?? fingerprint;
    blockedSectionEntries.set(sectionId, existing);
  }

  for (const blockedSection of resolvedSectionImplementation.blockedSections) {
    blockSection(
      blockedSection,
      resolvedSectionImplementation.openIssues.find((issue) => issue.startsWith(`${blockedSection}:`))
        ?? `${blockedSection}: section implementation verification failed`
    );
  }

  for (const section of pageTask.sections) {
    const resultPath = path.join(outputDir, section.expectedResultPath);
    const sectionTaskPath = path.join(outputDir, section.sectionTaskPath);
    try {
      const result = await readJson(resultPath);
      const resultFingerprint = fingerprintResult(result);
      const shapeError = getSectionResultShapeError(result);
      if (shapeError) {
        blockSection(section.sectionId, `${section.sectionId}: ${shapeError}`, resultFingerprint);
        continue;
      }
      const sectionTask = await readJson(sectionTaskPath);
      const policyError = await getSectionResultPolicyErrorWithNotes(result, sectionTask, { rootDir });
      if (policyError) {
        blockSection(section.sectionId, `${section.sectionId}: ${policyError}`, resultFingerprint);
        continue;
      }
      if (result.status !== "completed") {
        blockSection(
          section.sectionId,
          `${section.sectionId}: section result status is ${result.status}`,
          resultFingerprint
        );
      }
      sectionResults.push(section.expectedResultPath);
      collectedSectionResults.push(result);
    } catch (error) {
      blockSection(section.sectionId, `${section.sectionId}: missing section result at ${section.expectedResultPath}`);
    }
  }

  const { ledger: currentRetryLedger } = await readRetryLedger({ outputDir, pageTask });
  const retryLedger = updateRetryLedger({
    ledger: currentRetryLedger,
    pageTask,
    blockedSections: [...blockedSectionEntries.values()]
  });
  const { relativePath: retryLedgerPath } = await writeRetryLedger({
    outputDir,
    pageTask,
    ledger: retryLedger
  });
  const blockedSections = [...new Set(blockedSectionEntries.keys())];
  for (const blockedSection of blockedSectionEntries.values()) {
    openIssues.push(...blockedSection.openIssues);
  }

  if (!isGlobalSurface && !resolvedPreviewVerified) {
    openIssues.push("preview verification has not been marked complete");
  }
  if (!isGlobalSurface && !resolvedSectionImplementation.verified) {
    openIssues.push(...resolvedSectionImplementation.openIssues);
  }
  const requiresLayoutReview =
    !isGlobalSurface &&
    (
      pageTask.fidelity?.requireExplicitLayoutReview === true ||
      sectionResultsRequireLayoutReview(collectedSectionResults)
    );
  if (requiresLayoutReview && !layoutReviewPassed) {
    openIssues.push("layout review has not been marked complete");
  }
  if (!isGlobalSurface && !themeCheckPassed) {
    openIssues.push("theme check has not been marked complete");
  }
  if (!isGlobalSurface && !runtimeInspectPassed) {
    openIssues.push("runtime inspect has not been marked complete");
  }
  if (!isGlobalSurface && !runtimeVerifyPassed) {
    openIssues.push("runtime verify has not been marked complete");
  }

  for (const [sectionId, entry] of Object.entries(retryLedger.sections ?? {})) {
    if (entry?.status === "exhausted") {
      openIssues.push(`${sectionId}: retry budget exhausted after ${entry.attemptCount} failed attempts`);
    }
  }

  const status =
    blockedSections.length > 0
      ? "blocked"
      : isGlobalSurface || (
        resolvedPreviewVerified &&
        resolvedSectionImplementation.verified &&
        (!requiresLayoutReview || layoutReviewPassed) &&
        themeCheckPassed &&
        runtimeInspectPassed &&
        runtimeVerifyPassed
      )
        ? "passed"
        : "failed";

  const summary = {
    pageKey: pageTask.pageKey,
    profile: pageTask.profile,
    retryLedgerPath,
    sectionResults,
    commandsRun: buildCommandsRun({
      pageTaskPath,
      surfaceType: pageTask.surfaceType,
      previewVerified: resolvedPreviewVerified,
      sectionImplementationVerified: resolvedSectionImplementation.verified,
      layoutReviewPassed,
      themeCheckPassed,
      runtimeInspectPassed,
      runtimeVerifyPassed
    }),
    previewVerified: resolvedPreviewVerified,
    sectionImplementationVerified: resolvedSectionImplementation.verified,
    layoutReviewPassed,
    themeCheckPassed,
    runtimeInspectPassed,
    runtimeVerifyPassed,
    blockedSections,
    openIssues,
    status
  };

  await writeJson(path.join(outputDir, pageTask.pageVerificationPath), summary);
  return summary;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const outputDir = args[0] ? path.resolve(args[0]) : path.join(process.cwd(), "starter", "theme");
  const pageTaskPath = args[1]
    ? path.resolve(args[1])
    : path.join(outputDir, "agent", "page.home.task.json");
  const summary = await buildPageVerification({
    outputDir,
    pageTaskPath,
    rootDir: process.cwd(),
    previewVerified: args.includes("--preview-verified"),
    sectionImplementationVerified: args.includes("--section-implementation-verified"),
    layoutReviewPassed: args.includes("--layout-review-passed"),
    themeCheckPassed: args.includes("--theme-check-passed"),
    runtimeInspectPassed: args.includes("--runtime-inspect-passed"),
    runtimeVerifyPassed: args.includes("--runtime-verify-passed")
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
