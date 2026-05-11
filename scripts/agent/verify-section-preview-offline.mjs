import fs from "node:fs/promises";
import path from "node:path";

import { isMainModule } from "../../harness/shared/is-main-module.mjs";

const DEFAULT_PREVIEW_HTML_TEMPLATE = ({ pageKey, sectionId }) =>
  path.posix.join("output", "section-snapshots", pageKey, sectionId, "preview.html");

const DEFAULT_SCREENSHOT_DIR_TEMPLATE = ({ pageKey, sectionId }) =>
  path.posix.join("output", "playwright", "section-previews", pageKey, sectionId);

const DEFAULT_ARTIFACT_PATH_TEMPLATE = ({ outputDir, pageKey, sectionId }) =>
  path.join(
    outputDir,
    "agent",
    "section-previews",
    `${pageKey}.${sectionId}.preview.json`
  );

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function unwrapPlaywrightModule(mod) {
  // The playwright package is published as CJS; named exports like `chromium` are attached to
  // module.exports. When ESM `import()` loads a CJS file by absolute path, those named exports
  // are reachable through `default` (and, on some Node versions, the synthetic `module.exports`
  // key). Bare `import("playwright")` already exposes them directly, so we accept whichever
  // shape we get.
  if (mod && typeof mod === "object" && mod.chromium) {
    return mod;
  }
  if (mod?.default && mod.default.chromium) {
    return mod.default;
  }
  if (mod?.["module.exports"] && mod["module.exports"].chromium) {
    return mod["module.exports"];
  }
  return null;
}

async function loadPlaywrightFrom(rootDir) {
  // Prefer bare specifier resolution. Because this file is overlaid into the project's own
  // tree (./scripts/agent/...), Node walks upward and finds the project's node_modules first;
  // bare `import("playwright")` therefore resolves the project devDependency and exposes the
  // package's real ESM-friendly named exports.
  for (const specifier of ["playwright", "playwright-core"]) {
    try {
      const mod = unwrapPlaywrightModule(await import(specifier));
      if (mod) {
        return mod;
      }
    } catch {
      // fall through to absolute-path attempts
    }
  }

  const candidates = [
    path.join(rootDir, "node_modules", "playwright"),
    path.join(rootDir, "node_modules", "playwright-core")
  ];
  for (const candidate of candidates) {
    if (!(await pathExists(candidate))) {
      continue;
    }
    for (const entry of [
      path.join(candidate, "index.mjs"),
      path.join(candidate, "index.js")
    ]) {
      if (!(await pathExists(entry))) {
        continue;
      }
      try {
        const mod = unwrapPlaywrightModule(await import(entry));
        if (mod) {
          return mod;
        }
      } catch {
        // try next entry
      }
    }
  }

  throw new Error(
    "verify-section-preview-offline requires `playwright` to be installed in the project. " +
      "Run `pnpm add -D playwright` (or `npm install --save-dev playwright`) and `npx playwright install chromium`, then retry."
  );
}

function getFigmaBaselines(sectionTask) {
  return {
    desktop: sectionTask.brief?.layout?.desktop?.preview?.path ?? null,
    mobile: sectionTask.brief?.layout?.mobile?.preview?.path ?? null
  };
}

function relativeToRoot(rootDir, absolutePath) {
  const rel = path.relative(rootDir, absolutePath);
  return rel.split(path.sep).join(path.posix.sep);
}

async function ensurePreviewHtml({
  rootDir,
  previewHtmlPath,
  pageKey,
  sectionId
}) {
  const absolutePath = path.isAbsolute(previewHtmlPath)
    ? previewHtmlPath
    : path.join(rootDir, previewHtmlPath);
  if (!(await pathExists(absolutePath))) {
    throw new Error(
      `Offline preview HTML not found at ${relativeToRoot(rootDir, absolutePath)}. ` +
        `Render the section markup once into ${DEFAULT_PREVIEW_HTML_TEMPLATE({ pageKey, sectionId })} (link assets/kik-theme.css) before running verify-section-preview-offline.`
    );
  }
  return absolutePath;
}

async function captureViewport({
  browser,
  fileUrl,
  width,
  height,
  screenshotPath
}) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1
  });
  const page = await context.newPage();
  await page.goto(fileUrl, { waitUntil: "networkidle" });
  await page.screenshot({ path: screenshotPath, fullPage: false });
  const probe = await page.evaluate(() => ({
    title: document.title,
    bodyChildCount: document.body?.childElementCount ?? 0,
    sectionMountCount: document.querySelectorAll("[data-kik-section], section").length
  }));
  await context.close();
  return {
    width,
    height,
    screenshotPath,
    title: probe.title,
    bodyChildCount: probe.bodyChildCount,
    sectionMountCount: probe.sectionMountCount
  };
}

export async function verifySectionPreviewOffline({
  rootDir,
  outputDir = path.join(rootDir, "starter", "theme"),
  sectionTaskPath,
  resultPath,
  previewHtmlPath
}) {
  const sectionTask = await readJson(sectionTaskPath);
  const resolvedResultPath = resultPath
    ? path.resolve(resultPath)
    : path.join(outputDir, sectionTask.expectedResultPath);
  const browserConfigPath = path.join(rootDir, "harness", "config", "browser-verification.json");
  const browserConfig = await readJson(browserConfigPath);

  const stylesheetPath = path.join(rootDir, "assets", "kik-theme.css");
  if (!(await pathExists(stylesheetPath))) {
    throw new Error(
      "assets/kik-theme.css is missing. Run `pnpm build:css` (or your project's tailwind build) before verify-section-preview-offline so the offline snapshot uses the same utility CSS as the storefront."
    );
  }

  const resolvedPreviewHtmlPath = await ensurePreviewHtml({
    rootDir,
    previewHtmlPath:
      previewHtmlPath ??
      DEFAULT_PREVIEW_HTML_TEMPLATE({
        pageKey: sectionTask.pageKey,
        sectionId: sectionTask.sectionId
      }),
    pageKey: sectionTask.pageKey,
    sectionId: sectionTask.sectionId
  });

  const screenshotDir = path.join(
    rootDir,
    DEFAULT_SCREENSHOT_DIR_TEMPLATE({
      pageKey: sectionTask.pageKey,
      sectionId: sectionTask.sectionId
    })
  );
  await fs.mkdir(screenshotDir, { recursive: true });

  const playwright = await loadPlaywrightFrom(rootDir);
  const browser = await playwright.chromium.launch({ headless: true });

  let desktop;
  let mobile;
  try {
    const fileUrl = `file://${resolvedPreviewHtmlPath}`;
    desktop = await captureViewport({
      browser,
      fileUrl,
      width: browserConfig.desktopViewport.width,
      height: browserConfig.desktopViewport.height,
      screenshotPath: path.join(screenshotDir, "desktop.png")
    });
    mobile = await captureViewport({
      browser,
      fileUrl,
      width: browserConfig.mobileViewport.width,
      height: browserConfig.mobileViewport.height,
      screenshotPath: path.join(screenshotDir, "mobile.png")
    });
  } finally {
    await browser.close();
  }

  const failureReasons = [];
  if (desktop.sectionMountCount < 1) {
    failureReasons.push("desktop preview HTML mounted no <section> nodes");
  }
  if (mobile.sectionMountCount < 1) {
    failureReasons.push("mobile preview HTML mounted no <section> nodes");
  }

  const artifactPath = DEFAULT_ARTIFACT_PATH_TEMPLATE({
    outputDir,
    pageKey: sectionTask.pageKey,
    sectionId: sectionTask.sectionId
  });
  const artifactRelativePath = relativeToRoot(outputDir, artifactPath);
  const figmaBaselines = getFigmaBaselines(sectionTask);
  const previewUrl = `file://${resolvedPreviewHtmlPath}`;
  const view = `kik-section-${sectionTask.pageKey}-${sectionTask.sectionId}-offline`;
  const summary = {
    pageKey: sectionTask.pageKey,
    sectionId: sectionTask.sectionId,
    mode: "offline-snapshot",
    view,
    previewTemplatePath: relativeToRoot(rootDir, resolvedPreviewHtmlPath),
    previewUrl,
    desktop: { ...desktop, screenshotPath: relativeToRoot(rootDir, desktop.screenshotPath) },
    mobile: { ...mobile, screenshotPath: relativeToRoot(rootDir, mobile.screenshotPath) },
    figmaBaselines,
    visualReviewStatus: "pending-human-review",
    status: failureReasons.length > 0 ? "failed" : "passed",
    ...(failureReasons.length > 0 ? { failureReasons } : {})
  };

  await writeJson(artifactPath, summary);

  if (failureReasons.length > 0) {
    throw new Error(failureReasons.join("; "));
  }

  const result = await readJson(resolvedResultPath);
  const updatedResult = {
    ...result,
    verification: {
      ...result.verification,
      checks: {
        ...(result.verification?.checks ?? {}),
        sectionPreviewRendered: true
      }
    },
    sectionPreview: {
      status: "pending-human-review",
      mode: "offline-snapshot",
      templatePath: relativeToRoot(rootDir, resolvedPreviewHtmlPath),
      view,
      previewUrl,
      artifactPath: artifactRelativePath,
      figmaBaselines,
      runtimeScreenshots: {
        desktop: relativeToRoot(rootDir, desktop.screenshotPath),
        mobile: relativeToRoot(rootDir, mobile.screenshotPath)
      }
    }
  };
  await writeJson(resolvedResultPath, updatedResult);

  return summary;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootDir = args[0] ? path.resolve(args[0]) : process.cwd();
  const outputDir = args[1]
    ? path.resolve(args[1])
    : path.join(rootDir, "starter", "theme");
  const sectionTaskPath = args[2]
    ? path.resolve(args[2])
    : path.join(outputDir, "agent", "sections", "home.section-01.task.json");
  const resultPath = args[3] ? path.resolve(args[3]) : undefined;
  const previewHtmlPath = args[4] ? path.resolve(args[4]) : undefined;
  const summary = await verifySectionPreviewOffline({
    rootDir,
    outputDir,
    sectionTaskPath,
    resultPath,
    previewHtmlPath
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
