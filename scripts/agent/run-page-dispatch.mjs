import fs from "node:fs/promises";
import path from "node:path";

import { isMainModule } from "../../harness/shared/is-main-module.mjs";
import { buildPageVerification } from "./build-page-verification.mjs";
import {
  getSectionResultPolicyErrorWithNotes,
  getSectionResultShapeError
} from "./section-result-validation.mjs";
import { sectionImplementationArtifactRelativePath } from "../verify/verify-section-implementation.mjs";

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

export async function runPageDispatch({
  outputDir,
  pageDispatchPath,
  rootDir,
  previewVerified = false,
  sectionImplementationVerified = false,
  layoutReviewPassed = false,
  themeCheckPassed = false,
  runtimeInspectPassed = false,
  runtimeVerifyPassed = false
}) {
  const dispatch = await readJson(pageDispatchPath);
  const pageTaskPath = path.join(outputDir, dispatch.pageTaskPath);
  const pageTask = await readJson(pageTaskPath);
  const isGlobalSurface = pageTask.surfaceType === "global";
  const resolvedPreviewVerified = await resolvePreviewVerified({
    outputDir,
    pageKey: dispatch.pageKey,
    explicitPreviewVerified: previewVerified
  });
  const resolvedSectionImplementation = await resolveSectionImplementationVerification({
    outputDir,
    pageKey: dispatch.pageKey
  });

  const pendingSections = [];
  const completedSections = [];
  const blockedSections = [];
  const openIssues = [];
  const collectedSectionResults = [];

  for (const section of dispatch.sections) {
    const resultPath = path.join(outputDir, section.expectedResultPath);
    const sectionTaskPath = path.join(outputDir, section.sectionTaskPath);
    try {
      const result = await readJson(resultPath);
      const shapeError = getSectionResultShapeError(result);
      if (shapeError) {
        blockedSections.push(section.sectionId);
        openIssues.push(`${section.sectionId}: ${shapeError}`);
        continue;
      }

      const sectionTask = await readJson(sectionTaskPath);
      const policyError = await getSectionResultPolicyErrorWithNotes(result, sectionTask, { rootDir });
      if (policyError) {
        blockedSections.push(section.sectionId);
        openIssues.push(`${section.sectionId}: ${policyError}`);
      } else if (result.status === "completed") {
        completedSections.push(section.sectionId);
        collectedSectionResults.push(result);
      } else {
        blockedSections.push(section.sectionId);
        openIssues.push(`${section.sectionId}: section result status is ${result.status}`);
      }
    } catch (error) {
      if (error?.code === "ENOENT") {
        pendingSections.push(section.sectionId);
        continue;
      }

      blockedSections.push(section.sectionId);
      openIssues.push(`${section.sectionId}: unable to read section result at ${section.expectedResultPath}`);
    }
  }

  let status = "pending";
  const requiresLayoutReview =
    !isGlobalSurface &&
    (
      pageTask.fidelity?.requireExplicitLayoutReview === true ||
      sectionResultsRequireLayoutReview(collectedSectionResults)
    );
  const pageChecksSatisfied =
    isGlobalSurface ||
    (
      resolvedPreviewVerified &&
      (!requiresLayoutReview || layoutReviewPassed) &&
      themeCheckPassed &&
      runtimeInspectPassed &&
      runtimeVerifyPassed
    );

  if (blockedSections.length > 0) {
    status = "blocked";
  } else if (pendingSections.length === 0) {
    if (
      pageChecksSatisfied
    ) {
      const verification = await buildPageVerification({
        outputDir,
        pageTaskPath,
        previewVerified: resolvedPreviewVerified,
        sectionImplementationVerified: resolvedSectionImplementation.verified,
        layoutReviewPassed,
        themeCheckPassed,
        runtimeInspectPassed,
        runtimeVerifyPassed
      });
      status = verification.status === "passed" ? "verified" : "blocked";
      if (verification.status !== "passed") {
        blockedSections.push(...verification.blockedSections.filter((sectionId) => !blockedSections.includes(sectionId)));
        openIssues.push(...verification.openIssues);
      }
    } else if (!isGlobalSurface && resolvedSectionImplementation.blockedSections.length > 0) {
      status = "blocked";
      blockedSections.push(
        ...resolvedSectionImplementation.blockedSections.filter((sectionId) => !blockedSections.includes(sectionId))
      );
      openIssues.push(...resolvedSectionImplementation.openIssues);
    } else {
      status = "awaiting-page-checks";
      if (!resolvedPreviewVerified) {
        openIssues.push("preview verification has not been marked complete");
      }
      if (!resolvedSectionImplementation.verified) {
        openIssues.push(...resolvedSectionImplementation.openIssues);
      }
      if (requiresLayoutReview && !layoutReviewPassed) {
        openIssues.push("layout review has not been marked complete");
      }
      if (!themeCheckPassed) {
        openIssues.push("theme check has not been marked complete");
      }
      if (!runtimeInspectPassed) {
        openIssues.push("runtime inspect has not been marked complete");
      }
      if (!runtimeVerifyPassed) {
        openIssues.push("runtime verify has not been marked complete");
      }
    }
  }

  const summary = {
    pageKey: dispatch.pageKey,
    profile: dispatch.profile,
    pageDispatchPath: path.relative(outputDir, pageDispatchPath).split(path.sep).join(path.posix.sep),
    pendingSections,
    completedSections,
    blockedSections,
    openIssues,
    pageVerificationPath:
      pendingSections.length === 0 && pageChecksSatisfied
        ? path.posix.join("agent", `page.${dispatch.pageKey}.verification.json`)
        : null,
    status
  };

  await writeJson(path.join(outputDir, "agent", `page.${dispatch.pageKey}.run.json`), summary);
  return summary;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const outputDir = args[0] ? path.resolve(args[0]) : path.join(process.cwd(), "starter", "theme");
  const pageDispatchPath = args[1]
    ? path.resolve(args[1])
    : path.join(outputDir, "agent", "page.home.dispatch.json");
  const summary = await runPageDispatch({
    outputDir,
    pageDispatchPath,
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
