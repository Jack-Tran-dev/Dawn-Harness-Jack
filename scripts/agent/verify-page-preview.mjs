import childProcess from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { isMainModule } from "../../harness/shared/is-main-module.mjs";

const DEFAULT_PWCLI_BIN = path.join(
  process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex"),
  "skills",
  "playwright",
  "scripts",
  "playwright_cli.sh"
);

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function runPwcli({ pwcliBin, session, args, cwd, env }) {
  const result = childProcess.spawnSync(pwcliBin, ["--session", session, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      ...env
    }
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || `Playwright CLI command failed: ${args.join(" ")}`);
  }

  return result.stdout?.trim() || "";
}

function browserSessionName(pageKey) {
  const normalized = String(pageKey)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `sth-${normalized || "page"}`;
}

function wrapRunCodeScript(script) {
  return `async (page) => {\n${script}\n}`;
}

function parseJsonOutput(output, context) {
  const candidate = output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);

  if (!candidate) {
    throw new Error(`Expected JSON output from ${context}`);
  }

  const parsed = JSON.parse(candidate);
  if (typeof parsed === "string") {
    return JSON.parse(parsed);
  }
  return parsed;
}

function detectPasswordGateScript() {
  return [
    "/* preview-verifier:detect-password-gate */",
    "const passwordRequired = await page.locator('input[type=\"password\"], input[name=\"password\"]').count() > 0;",
    "return JSON.stringify({ passwordRequired });"
  ].join("\n");
}

function submitStorefrontPasswordScript(password) {
  return [
    "/* preview-verifier:submit-storefront-password */",
    `const password = ${JSON.stringify(password)};`,
    "const passwordField = page.locator('input[type=\"password\"], input[name=\"password\"]').first();",
    "await passwordField.fill(password);",
    "const submitButton = page.locator('button[type=\"submit\"], input[type=\"submit\"], button:has-text(\"Enter\"), button:has-text(\"Submit\")').first();",
    "if (await submitButton.count() > 0) {",
    "  await submitButton.click();",
    "} else {",
    "  await passwordField.press('Enter');",
    "}",
    "await page.waitForTimeout(500);",
    "return JSON.stringify({ submitted: true });"
  ].join("\n");
}

function capturePreviewStateScript({ label, screenshotAbsolutePath, screenshotRelativePath }) {
  return [
    `/* preview-verifier:capture-preview-state:${label} */`,
    `/* screenshot-path:${screenshotAbsolutePath} */`,
    `const screenshotPath = ${JSON.stringify(screenshotAbsolutePath)};`,
    "await page.screenshot({ path: screenshotPath, fullPage: true });",
    "const title = await page.title();",
    "const url = page.url();",
    "const sectionMountCount = await page.locator('[id^=\"shopify-section-\"]').count();",
    `return JSON.stringify({ title, url, sectionMountCount, screenshotPath: ${JSON.stringify(screenshotRelativePath)} });`
  ].join("\n");
}

function routeUrlFromConfig({ pageTask, browserConfig }) {
  const routeKey = pageTask.preview.routeKey;
  const previewUrl = browserConfig[routeKey];
  if (!previewUrl) {
    throw new Error(`Missing browser verification URL for route key: ${routeKey}`);
  }
  return previewUrl;
}

function previewResultPath(outputDir, pageKey) {
  return path.join(outputDir, "agent", `page.${pageKey}.preview.json`);
}

function normalizeCount(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isShopifyUploadErrorState({ title, pageText }) {
  const combined = `${title ?? ""}\n${pageText ?? ""}`.toLowerCase();
  return (
    combined.includes("failed to upload theme files") ||
    combined.includes("upload error page") ||
    combined.includes("generated template file") ||
    combined.includes("could not be processed") ||
    combined.includes("could not be uploaded")
  );
}

function buildFailureSummary({
  pageTask,
  previewUrl,
  passwordPageDetected,
  passwordSubmitted,
  desktop,
  mobile,
  failureReasons
}) {
  return {
    pageKey: pageTask.pageKey,
    surfaceType: pageTask.surfaceType,
    routeKey: pageTask.preview.routeKey,
    previewUrl,
    passwordPageDetected,
    passwordSubmitted,
    desktop,
    mobile,
    status: "failed",
    failureContext: {
      expectedSectionCount: pageTask.sections.length,
      desktopSectionMountCount: normalizeCount(desktop.sectionMountCount),
      mobileSectionMountCount: normalizeCount(mobile.sectionMountCount),
      desktopTitle: desktop.title ?? "",
      mobileTitle: mobile.title ?? "",
      desktopPageText: desktop.pageText ?? "",
      mobilePageText: mobile.pageText ?? "",
      failureReasons
    }
  };
}

async function verifyViewport({
  pwcliBin,
  session,
  cwd,
  env,
  rootDir,
  width,
  height,
  screenshotAbsolutePath,
  screenshotRelativePath,
  label
}) {
  runPwcli({
    pwcliBin,
    session,
    cwd,
    env,
    args: ["resize", String(width), String(height)]
  });

  const output = runPwcli({
    pwcliBin,
    session,
    cwd,
    env,
    args: [
      "--raw",
      "run-code",
      wrapRunCodeScript(capturePreviewStateScript({ label, screenshotAbsolutePath, screenshotRelativePath }))
    ]
  });

  const summary = parseJsonOutput(output, `capture ${label} preview state`);
  const normalizedScreenshotPath =
    typeof summary.screenshotPath === "string" && path.isAbsolute(summary.screenshotPath)
      ? path.relative(rootDir, summary.screenshotPath).split(path.sep).join(path.posix.sep)
      : summary.screenshotPath;

  return {
    width,
    height,
    ...summary,
    screenshotPath: normalizedScreenshotPath
  };
}

export async function verifyPagePreview({
  rootDir,
  outputDir = path.join(rootDir, "starter", "theme"),
  pageTaskPath,
  pwcliBin = process.env.PWCLI_BIN || DEFAULT_PWCLI_BIN,
  env = {}
}) {
  const pageTask = await readJson(pageTaskPath);
  const browserConfigPath = path.join(rootDir, pageTask.preview.configPath);
  const browserConfig = await readJson(browserConfigPath);
  const previewUrl = routeUrlFromConfig({ pageTask, browserConfig });
  const session = browserSessionName(pageTask.pageKey);
  const screenshotDir = path.join(rootDir, "output", "playwright", pageTask.pageKey);

  await fs.mkdir(screenshotDir, { recursive: true });

  runPwcli({
    pwcliBin,
    session,
    cwd: rootDir,
    env,
    args: ["open", previewUrl]
  });

  const detectionOutput = runPwcli({
    pwcliBin,
    session,
    cwd: rootDir,
    env,
    args: ["--raw", "run-code", wrapRunCodeScript(detectPasswordGateScript())]
  });
  const detection = parseJsonOutput(detectionOutput, "password gate detection");
  const passwordPageDetected = detection.passwordRequired === true;
  let passwordSubmitted = false;

  if (passwordPageDetected) {
    if (!browserConfig.storefrontPassword) {
      throw new Error(`Preview route requires a storefront password for ${pageTask.pageKey}, but no storefront password is configured.`);
    }

    const submitOutput = runPwcli({
      pwcliBin,
      session,
      cwd: rootDir,
      env,
      args: [
        "--raw",
        "run-code",
        wrapRunCodeScript(submitStorefrontPasswordScript(browserConfig.storefrontPassword))
      ]
    });
    const submitResult = parseJsonOutput(submitOutput, "storefront password submission");
    passwordSubmitted = submitResult.submitted === true;
  }

  const desktopRelativePath = path.posix.join("output", "playwright", pageTask.pageKey, "desktop.png");
  const mobileRelativePath = path.posix.join("output", "playwright", pageTask.pageKey, "mobile.png");

  const desktop = await verifyViewport({
    pwcliBin,
    session,
    cwd: rootDir,
    env,
    rootDir,
    width: browserConfig.desktopViewport.width,
    height: browserConfig.desktopViewport.height,
    screenshotAbsolutePath: path.join(rootDir, desktopRelativePath),
    screenshotRelativePath: desktopRelativePath,
    label: "desktop"
  });

  const mobile = await verifyViewport({
    pwcliBin,
    session,
    cwd: rootDir,
    env,
    rootDir,
    width: browserConfig.mobileViewport.width,
    height: browserConfig.mobileViewport.height,
    screenshotAbsolutePath: path.join(rootDir, mobileRelativePath),
    screenshotRelativePath: mobileRelativePath,
    label: "mobile"
  });

  const expectedSectionCount = pageTask.sections.length;
  const desktopSectionMountCount = normalizeCount(desktop.sectionMountCount);
  const mobileSectionMountCount = normalizeCount(mobile.sectionMountCount);
  const mountedSectionCount = Math.min(desktopSectionMountCount, mobileSectionMountCount);
  const failureReasons = [];

  if (isShopifyUploadErrorState(desktop) || isShopifyUploadErrorState(mobile)) {
    failureReasons.push("browser reported a Shopify upload error page");
  }

  if (mountedSectionCount < expectedSectionCount) {
    failureReasons.push(
      `mounted section count (${mountedSectionCount}) is lower than expected section count (${expectedSectionCount})`
    );
  }

  runPwcli({
    pwcliBin,
    session,
    cwd: rootDir,
    env,
    args: ["close"]
  });

  if (failureReasons.length > 0) {
    const summary = buildFailureSummary({
      pageTask,
      previewUrl,
      passwordPageDetected,
      passwordSubmitted,
      desktop,
      mobile,
      failureReasons
    });
    await writeJson(previewResultPath(outputDir, pageTask.pageKey), summary);

    const error = new Error(
      `Preview verification failed for ${pageTask.pageKey}: ${failureReasons.join("; ")}`
    );
    error.summary = summary;
    error.failureContext = summary.failureContext;
    throw error;
  }

  const summary = {
    pageKey: pageTask.pageKey,
    surfaceType: pageTask.surfaceType,
    routeKey: pageTask.preview.routeKey,
    previewUrl,
    passwordPageDetected,
    passwordSubmitted,
    desktop,
    mobile,
    status: "passed"
  };

  await writeJson(previewResultPath(outputDir, pageTask.pageKey), summary);
  return summary;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootDir = args[0] ? path.resolve(args[0]) : process.cwd();
  const outputDir = args[1] ? path.resolve(args[1]) : path.join(rootDir, "starter", "theme");
  const pageTaskPath = args[2]
    ? path.resolve(args[2])
    : path.join(outputDir, "agent", "page.home.task.json");
  const summary = await verifyPagePreview({ rootDir, outputDir, pageTaskPath });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
