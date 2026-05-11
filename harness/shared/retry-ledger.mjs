import fs from "node:fs/promises";
import path from "node:path";

export const DEFAULT_MAX_ATTEMPTS_PER_SECTION = 3;

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function defaultRetryPolicy(pageTask = null) {
  const configuredValue = pageTask?.retryPolicy?.maxAttemptsPerSection;
  return {
    maxAttemptsPerSection:
      Number.isInteger(configuredValue) && configuredValue > 0
        ? configuredValue
        : DEFAULT_MAX_ATTEMPTS_PER_SECTION
  };
}

export function retryLedgerRelativePath(pageKey) {
  return path.posix.join("agent", `page.${pageKey}.retry-ledger.json`);
}

export function emptyRetryLedger(pageTask) {
  return {
    pageKey: pageTask.pageKey,
    maxAttemptsPerSection: defaultRetryPolicy(pageTask).maxAttemptsPerSection,
    sections: {}
  };
}

export async function readRetryLedger({ outputDir, pageTask }) {
  const relativePath = pageTask.pageRetryLedgerPath ?? retryLedgerRelativePath(pageTask.pageKey);
  const absolutePath = path.join(outputDir, relativePath);

  try {
    const ledger = await readJson(absolutePath);
    return {
      relativePath,
      absolutePath,
      ledger: {
        ...emptyRetryLedger(pageTask),
        ...ledger,
        sections: ledger?.sections && typeof ledger.sections === "object" ? ledger.sections : {}
      }
    };
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
    return {
      relativePath,
      absolutePath,
      ledger: emptyRetryLedger(pageTask)
    };
  }
}

export async function writeRetryLedger({ outputDir, pageTask, ledger }) {
  const relativePath = pageTask.pageRetryLedgerPath ?? retryLedgerRelativePath(pageTask.pageKey);
  const absolutePath = path.join(outputDir, relativePath);
  await writeJson(absolutePath, ledger);
  return {
    relativePath,
    absolutePath
  };
}

export function getSectionRetryStatus(ledger, pageTask, sectionId) {
  const entry = ledger?.sections?.[sectionId];
  if (!entry) {
    return {
      attemptCount: 0,
      status: "active",
      maxAttemptsPerSection: defaultRetryPolicy(pageTask).maxAttemptsPerSection
    };
  }

  return {
    ...entry,
    maxAttemptsPerSection: ledger.maxAttemptsPerSection
  };
}

export function updateRetryLedger({ ledger, pageTask, blockedSections }) {
  const nextLedger = {
    ...ledger,
    pageKey: pageTask.pageKey,
    maxAttemptsPerSection: defaultRetryPolicy(pageTask).maxAttemptsPerSection,
    sections: {
      ...(ledger.sections ?? {})
    }
  };

  for (const blockedSection of blockedSections) {
    if (!blockedSection?.sectionId) {
      continue;
    }

    const previousEntry = nextLedger.sections[blockedSection.sectionId] ?? {
      attemptCount: 0,
      status: "active",
      history: []
    };

    if (previousEntry.status === "exhausted") {
      continue;
    }

    if (blockedSection.fingerprint && previousEntry.lastFailureFingerprint === blockedSection.fingerprint) {
      continue;
    }

    const attemptCount = previousEntry.attemptCount + 1;
    const status = attemptCount >= nextLedger.maxAttemptsPerSection ? "exhausted" : "active";
    const recordedAt = new Date().toISOString();
    const failureFingerprint =
      blockedSection.fingerprint ?? `observation:${blockedSection.sectionId}:${attemptCount}`;

    nextLedger.sections[blockedSection.sectionId] = {
      ...previousEntry,
      attemptCount,
      status,
      lastFailureFingerprint: failureFingerprint,
      lastBlockedReason: blockedSection.openIssues?.[0] ?? "section verification blocked",
      lastAttemptAt: recordedAt,
      history: [
        ...(Array.isArray(previousEntry.history) ? previousEntry.history : []),
        {
          attempt: attemptCount,
          fingerprint: failureFingerprint,
          recordedAt,
          openIssues: blockedSection.openIssues ?? []
        }
      ]
    };
  }

  return nextLedger;
}
