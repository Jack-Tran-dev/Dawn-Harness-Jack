import path from "node:path";

import { isMainModule } from "../../harness/shared/is-main-module.mjs";
import { inspectRuntime } from "../inspect/inspect-runtime.mjs";

export async function verifyRuntime({
  rootDir,
  outputDir = path.join(rootDir, "starter", "theme")
}) {
  const summary = await inspectRuntime({ rootDir, outputDir });
  const missingCaptureCount = summary.pages.reduce(
    (count, page) => count + page.missingCaptureCount,
    0
  );
  const mismatchedCaptureCount = summary.pages.reduce(
    (count, page) => count + page.diffStatuses["dimension-mismatch"],
    0
  );
  const fidelityMismatchCount = summary.pages.reduce(
    (count, page) => count + (page.diffStatuses["fidelity-mismatch"] || 0),
    0
  );
  const fidelityDiagnosisCounts = {};

  for (const page of summary.pages) {
    for (const capture of page.captures) {
      if (capture.diffStatus !== "fidelity-mismatch") {
        continue;
      }

      for (const category of capture.diagnosis?.categories ?? []) {
        fidelityDiagnosisCounts[category] = (fidelityDiagnosisCounts[category] ?? 0) + 1;
      }
    }
  }

  if (missingCaptureCount > 0) {
    throw new Error(`Missing runtime captures: ${missingCaptureCount}`);
  }

  if (mismatchedCaptureCount > 0) {
    throw new Error(`Runtime capture dimension mismatch: ${mismatchedCaptureCount}`);
  }

  if (fidelityMismatchCount > 0) {
    const diagnosisSummary = Object.entries(fidelityDiagnosisCounts)
      .map(([category, count]) => `${category}: ${count}`)
      .join(", ");
    throw new Error(
      diagnosisSummary.length > 0
        ? `Runtime capture fidelity mismatch: ${fidelityMismatchCount} (${diagnosisSummary})`
        : `Runtime capture fidelity mismatch: ${fidelityMismatchCount}`
    );
  }

  return {
    ok: true,
    pageCount: summary.pageCount,
    captureCount: summary.pages.reduce((count, page) => count + page.captureCount, 0)
  };
}

if (isMainModule(import.meta.url)) {
  try {
    const summary = await verifyRuntime({ rootDir: process.cwd() });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
