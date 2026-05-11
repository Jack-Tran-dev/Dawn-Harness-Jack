import fs from "node:fs/promises";
import path from "node:path";

import { isMainModule } from "../../harness/shared/is-main-module.mjs";

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

async function statMtimeMs(filePath) {
  return (await fs.stat(filePath)).mtimeMs;
}

function unique(values) {
  return [...new Set(values)];
}

async function resolveDeclaredPath({
  relativePath,
  rootDir,
  outputDir,
  preferredRoot,
  fallbackRoots = []
}) {
  if (!relativePath) {
    return null;
  }

  const normalizedPath = relativePath.split("/").join(path.sep);
  const orderedRoots = unique([preferredRoot, ...fallbackRoots].filter(Boolean));
  const candidates = orderedRoots.map((basePath) => ({
    absolutePath: path.resolve(basePath, normalizedPath),
    displayPath: relativePath
  }));

  for (const candidate of candidates) {
    if (await pathExists(candidate.absolutePath)) {
      return candidate;
    }
  }

  return candidates[0] ?? {
    absolutePath: path.resolve(rootDir, normalizedPath),
    displayPath: relativePath
  };
}

function buildPageTaskEntry({ pageTaskPath, outputDir }) {
  return {
    absolutePath: pageTaskPath,
    displayPath: path.relative(outputDir, pageTaskPath).split(path.sep).join("/")
  };
}

function buildArtifactEntry({ absolutePath, displayPath }) {
  return { absolutePath, displayPath };
}

async function collectPageDependencies({ pageTask, pageTaskPath, rootDir, outputDir }) {
  const dependencies = [buildPageTaskEntry({ pageTaskPath, outputDir })];

  const pageBundle = await resolveDeclaredPath({
    relativePath: pageTask.pageBundlePath,
    rootDir,
    outputDir,
    preferredRoot: rootDir,
    fallbackRoots: [outputDir]
  });
  if (pageBundle) {
    dependencies.push(pageBundle);
  }

  const previewTemplate = await resolveDeclaredPath({
    relativePath: pageTask.preview?.template,
    rootDir,
    outputDir,
    preferredRoot: rootDir,
    fallbackRoots: [outputDir]
  });
  if (previewTemplate) {
    dependencies.push(previewTemplate);
  }

  if (pageTask.deliveryTemplatePath) {
    const deliveryTemplate = await resolveDeclaredPath({
      relativePath: pageTask.deliveryTemplatePath,
      rootDir,
      outputDir,
      preferredRoot: rootDir,
      fallbackRoots: [outputDir]
    });
    if (deliveryTemplate) {
      dependencies.push(deliveryTemplate);
    }
  }

  for (const section of pageTask.sections ?? []) {
    const sectionEntries = await Promise.all([
      resolveDeclaredPath({
        relativePath: section.sectionTaskPath,
        rootDir,
        outputDir,
        preferredRoot: outputDir,
        fallbackRoots: [rootDir]
      }),
      resolveDeclaredPath({
        relativePath: section.expectedResultPath,
        rootDir,
        outputDir,
        preferredRoot: outputDir,
        fallbackRoots: [rootDir]
      }),
      resolveDeclaredPath({
        relativePath: section.starterSectionPath,
        rootDir,
        outputDir,
        preferredRoot: outputDir,
        fallbackRoots: [rootDir]
      }),
      resolveDeclaredPath({
        relativePath: section.desktopBundlePath,
        rootDir,
        outputDir,
        preferredRoot: rootDir,
        fallbackRoots: [outputDir]
      }),
      resolveDeclaredPath({
        relativePath: section.mobileBundlePath,
        rootDir,
        outputDir,
        preferredRoot: rootDir,
        fallbackRoots: [outputDir]
      }),
      resolveDeclaredPath({
        relativePath: section.desktopDetailPath,
        rootDir,
        outputDir,
        preferredRoot: rootDir,
        fallbackRoots: [outputDir]
      }),
      resolveDeclaredPath({
        relativePath: section.mobileDetailPath,
        rootDir,
        outputDir,
        preferredRoot: rootDir,
        fallbackRoots: [outputDir]
      })
    ]);

    for (const entry of sectionEntries) {
      if (entry) {
        dependencies.push(entry);
      }
    }
  }

  return dependencies;
}

async function findStaleDependencies({ artifactEntry, dependencies, issues, missingIssuePrefix }) {
  const staleDependencies = [];
  const missingDependencies = [];
  let artifactMtimeMs = null;

  if (await pathExists(artifactEntry.absolutePath)) {
    artifactMtimeMs = await statMtimeMs(artifactEntry.absolutePath);
  }

  for (const dependency of dependencies) {
    if (!(await pathExists(dependency.absolutePath))) {
      missingDependencies.push(dependency.displayPath);
      continue;
    }

    if (artifactMtimeMs === null) {
      continue;
    }

    const dependencyMtimeMs = await statMtimeMs(dependency.absolutePath);
    if (dependencyMtimeMs > artifactMtimeMs) {
      staleDependencies.push(dependency.displayPath);
    }
  }

  for (const dependencyPath of missingDependencies) {
    issues.push(`${missingIssuePrefix}: ${dependencyPath}`);
  }

  return staleDependencies;
}

async function evaluatePageAcceptance({ pageTaskPath, rootDir, outputDir }) {
  const pageTask = await readJson(pageTaskPath);
  const issues = [];
  const previewArtifact = buildArtifactEntry({
    absolutePath: path.join(outputDir, "agent", `page.${pageTask.pageKey}.preview.json`),
    displayPath: path.posix.join("agent", `page.${pageTask.pageKey}.preview.json`)
  });
  const verificationArtifact = buildArtifactEntry({
    absolutePath: path.join(outputDir, pageTask.pageVerificationPath),
    displayPath: pageTask.pageVerificationPath
  });

  let previewPayload = null;
  let verificationPayload = null;

  if (await pathExists(previewArtifact.absolutePath)) {
    previewPayload = await readJson(previewArtifact.absolutePath);
    if (previewPayload?.status !== "passed") {
      issues.push(`preview artifact status is ${previewPayload?.status ?? "missing"}`);
    }
  } else {
    issues.push(`missing preview artifact: ${previewArtifact.displayPath}`);
  }

  if (await pathExists(verificationArtifact.absolutePath)) {
    verificationPayload = await readJson(verificationArtifact.absolutePath);
    if (verificationPayload?.status !== "passed") {
      issues.push(`verification artifact status is ${verificationPayload?.status ?? "missing"}`);
    }
  } else {
    issues.push(`missing verification artifact: ${verificationArtifact.displayPath}`);
  }

  const baseDependencies = await collectPageDependencies({
    pageTask,
    pageTaskPath,
    rootDir,
    outputDir
  });
  const stalePreviewDependencies = await findStaleDependencies({
    artifactEntry: previewArtifact,
    dependencies: baseDependencies,
    issues,
    missingIssuePrefix: "missing preview dependency"
  });
  const staleVerificationDependencies = await findStaleDependencies({
    artifactEntry: verificationArtifact,
    dependencies: [...baseDependencies, previewArtifact],
    issues,
    missingIssuePrefix: "missing verification dependency"
  });

  if (stalePreviewDependencies.length > 0) {
    issues.push(
      `preview artifact is stale relative to: ${stalePreviewDependencies.join(", ")}`
    );
  }
  if (staleVerificationDependencies.length > 0) {
    issues.push(
      `verification artifact is stale relative to: ${staleVerificationDependencies.join(", ")}`
    );
  }

  return {
    pageKey: pageTask.pageKey,
    pageTaskPath: path.relative(outputDir, pageTaskPath).split(path.sep).join("/"),
    previewArtifact: previewArtifact.displayPath,
    verificationArtifact: verificationArtifact.displayPath,
    previewStatus: previewPayload?.status ?? null,
    verificationStatus: verificationPayload?.status ?? null,
    stalePreviewDependencies,
    staleVerificationDependencies,
    issues,
    ok: issues.length === 0
  };
}

async function discoverPageTaskPaths(outputDir) {
  const agentDir = path.join(outputDir, "agent");

  if (!(await pathExists(agentDir))) {
    return [];
  }

  const entries = await fs.readdir(agentDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^page\..+\.task\.json$/.test(entry.name))
    .map((entry) => path.join(agentDir, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

export async function assertPageAcceptance({
  rootDir = process.cwd(),
  outputDir = path.join(rootDir, "starter", "theme"),
  pageTaskPath = null
}) {
  const resolvedRootDir = path.resolve(rootDir);
  const resolvedOutputDir = path.resolve(outputDir);
  const pageTaskPaths = pageTaskPath
    ? [path.resolve(pageTaskPath)]
    : await discoverPageTaskPaths(resolvedOutputDir);

  const pages = [];
  for (const taskPath of pageTaskPaths) {
    pages.push(
      await evaluatePageAcceptance({
        pageTaskPath: taskPath,
        rootDir: resolvedRootDir,
        outputDir: resolvedOutputDir
      })
    );
  }

  return {
    ok: pages.every((page) => page.ok),
    rootDir: resolvedRootDir,
    outputDir: resolvedOutputDir,
    pageCount: pages.length,
    pages
  };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootDir = args[0] ? path.resolve(args[0]) : process.cwd();
  const outputDir = args[1] ? path.resolve(args[1]) : path.join(rootDir, "starter", "theme");
  const pageTaskPath = args[2] ? path.resolve(args[2]) : null;
  const summary = await assertPageAcceptance({ rootDir, outputDir, pageTaskPath });
  const serialized = `${JSON.stringify(summary, null, 2)}\n`;
  if (summary.ok) {
    process.stdout.write(serialized);
  } else {
    process.stderr.write(serialized);
    process.exitCode = 1;
  }
}
