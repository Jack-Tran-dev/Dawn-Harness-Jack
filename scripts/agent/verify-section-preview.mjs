import childProcess from "node:child_process";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

import { isMainModule } from "../../harness/shared/is-main-module.mjs";
import {
  createSectionPreview,
  getSectionPreviewDescriptor
} from "./create-section-preview.mjs";
import { getBriefProvenanceError } from "./brief-provenance.mjs";
import {
  preflightSectionPreview,
  applyDynamicPort,
  SectionPreviewBlocker
} from "./section-preview-preflight.mjs";

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

// macOS sun_path limit is 104 bytes. The Playwright daemon creates its socket
// inside $TMPDIR (e.g. Claude Code's per-agent /private/tmp/claude-501/-Users-...
// cache directory pushes the socket path past 104, producing an opaque
// `listen EINVAL: invalid argument` when the daemon tries to bind). The socket
// file name is roughly 40 chars (`playwright-mcp-<uuid>.sock`-shaped), so a
// TMPDIR of up to ~60 chars stays comfortably under the limit; the default
// macOS TMPDIR (`/var/folders/.../T/`, ~49 chars) sits inside that envelope
// and must NOT trigger the fallback — otherwise every macOS run reroutes
// through /tmp, which is shared and surprises callers. Threshold is set so
// common cache / agent / sandbox TMPDIRs (90+ chars) trip it while system
// defaults don't.
const TMPDIR_FALLBACK_THRESHOLD = 60;
const TMPDIR_FALLBACK_PATH = "/tmp/sth-pwcli";

export function applyTmpdirFallback(env, { platform = process.platform, log = noop } = {}) {
  if (platform !== "darwin") {
    return env;
  }
  const current = env.TMPDIR ?? "";
  if (!current || current.length <= TMPDIR_FALLBACK_THRESHOLD) {
    return env;
  }
  log(
    `verify-section-preview: TMPDIR is ${current.length} chars (${current}); ` +
    `falling back to ${TMPDIR_FALLBACK_PATH} to stay within the macOS 104-byte ` +
    `unix-socket path limit when the Playwright daemon creates its socket.`
  );
  return { ...env, TMPDIR: TMPDIR_FALLBACK_PATH };
}

function noop() {}

let tmpdirFallbackEnsured = false;
function ensureTmpdirFallbackDirectory() {
  if (tmpdirFallbackEnsured) {
    return;
  }
  try {
    fsSync.mkdirSync(TMPDIR_FALLBACK_PATH, { recursive: true });
  } catch (err) {
    if (err && err.code !== "EEXIST") {
      throw err;
    }
  }
  tmpdirFallbackEnsured = true;
}

function runPwcli({ pwcliBin, session, args, cwd, env }) {
  const merged = { ...process.env, ...env };
  const safeEnv = applyTmpdirFallback(merged, {
    log: (message) => process.stderr.write(`${message}\n`)
  });
  if (safeEnv.TMPDIR === TMPDIR_FALLBACK_PATH) {
    ensureTmpdirFallbackDirectory();
  }
  const result = childProcess.spawnSync(pwcliBin, ["--session", session, ...args], {
    cwd,
    encoding: "utf8",
    env: safeEnv
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || `Playwright CLI command failed: ${args.join(" ")}`);
  }

  return result.stdout?.trim() || "";
}

function browserSessionName({ pageKey, sectionId }) {
  const normalized = `${pageKey}-${sectionId}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return `sth-section-${normalized || "preview"}`;
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

function withPreviewView(rawUrl, view) {
  const url = new URL(rawUrl);
  url.searchParams.set("view", view);
  return url.toString();
}

function detectPasswordGateScript() {
  return [
    "/* section-preview-verifier:detect-password-gate */",
    "const passwordRequired = await page.locator('input[type=\"password\"], input[name=\"password\"]').count() > 0;",
    "return JSON.stringify({ passwordRequired });"
  ].join("\n");
}

function submitStorefrontPasswordScript(password) {
  return [
    "/* section-preview-verifier:submit-storefront-password */",
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

function capturePreviewStateScript({
  label,
  screenshotAbsolutePath,
  screenshotRelativePath,
  expectedRegions = [],
  expectedCanvas = null
}) {
  // expectedRegions: [{ name, sourceNodeId, x, y, width, height }] derived from the
  // brief for this breakpoint. expectedCanvas: { width, height } from brief.layout.
  // The probe runs in the page context. For each region with a sourceNodeId, it:
  //   1. Locates [data-kik-region="<sourceNodeId>"] inside any mounted section.
  //   2. If the brief region carries x/y/w/h AND a canvas is supplied, computes
  //      observed-vs-expected bounding-box deltas, normalized by the section's
  //      DOM bounding box (observed) and the canvas (expected). This is
  //      viewport-independent — desktop @1440 vs Figma canvas @1600 can be
  //      compared directly because both reduce to fractions in [0,1].
  // Presence + geometry are reported per region; the Node side decides which
  // failures to surface based on fidelity.mode and tolerance configuration.
  const probePayload = JSON.stringify(expectedRegions);
  const canvasPayload = JSON.stringify(expectedCanvas);
  const presenceProbe = [
    "const collectRegionPresence = ({ expected, canvas }) => {",
    "  if (!Array.isArray(expected) || expected.length === 0) {",
    "    return { evaluated: false, regions: [] };",
    "  }",
    "  const sectionRoots = Array.from(document.querySelectorAll('[id^=\"shopify-section-\"]'));",
    "  const regions = expected.map((entry) => {",
    "    if (!entry || typeof entry.sourceNodeId !== 'string' || entry.sourceNodeId.length === 0) {",
    "      return { name: entry && entry.name, sourceNodeId: null, matched: false, reason: 'missing-sourceNodeId' };",
    "    }",
    "    const escaped = entry.sourceNodeId.replace(/[\\\"\\\\]/g, (c) => '\\\\' + c);",
    // ~= matches when data-kik-region is a whitespace-separated list of node ids
    // containing the target as one token. This lets a single responsive element
    // represent multiple Figma nodes (desktop + mobile) by listing both ids,
    // e.g. data-kik-region=\"11928:8845 11928:7876\".
    "    const selector = '[data-kik-region~=\"' + escaped + '\"]';",
    "    let matchedRoot = null;",
    "    let matchedEl = null;",
    "    for (const root of sectionRoots) {",
    "      const found = root.querySelector(selector);",
    "      if (found) { matchedRoot = root; matchedEl = found; break; }",
    "    }",
    "    if (!matchedEl) {",
    "      return { name: entry.name, sourceNodeId: entry.sourceNodeId, matched: false };",
    "    }",
    "    const base = { name: entry.name, sourceNodeId: entry.sourceNodeId, matched: true, foundIn: matchedRoot.id };",
    "    const hasGeometry = canvas && typeof canvas.width === 'number' && typeof canvas.height === 'number' &&",
    "      typeof entry.x === 'number' && typeof entry.y === 'number' &&",
    "      typeof entry.width === 'number' && typeof entry.height === 'number' &&",
    "      canvas.width > 0 && canvas.height > 0;",
    "    if (!hasGeometry) {",
    "      return base;",
    "    }",
    "    const sectionRect = matchedRoot.getBoundingClientRect();",
    "    const elRect = matchedEl.getBoundingClientRect();",
    "    if (sectionRect.width === 0 || sectionRect.height === 0) {",
    "      return Object.assign(base, { geometryEvaluated: false, geometryReason: 'section-rect-zero' });",
    "    }",
    "    const observedNormalized = {",
    "      x: (elRect.left - sectionRect.left) / sectionRect.width,",
    "      y: (elRect.top - sectionRect.top) / sectionRect.height,",
    "      width: elRect.width / sectionRect.width,",
    "      height: elRect.height / sectionRect.height",
    "    };",
    "    const expectedNormalized = {",
    "      x: entry.x / canvas.width,",
    "      y: entry.y / canvas.height,",
    "      width: entry.width / canvas.width,",
    "      height: entry.height / canvas.height",
    "    };",
    "    const delta = {",
    "      x: Math.abs(observedNormalized.x - expectedNormalized.x),",
    "      y: Math.abs(observedNormalized.y - expectedNormalized.y),",
    "      width: Math.abs(observedNormalized.width - expectedNormalized.width),",
    "      height: Math.abs(observedNormalized.height - expectedNormalized.height)",
    "    };",
    "    return Object.assign(base, {",
    "      geometryEvaluated: true,",
    "      expectedNormalized,",
    "      observedNormalized,",
    "      delta",
    "    });",
    "  });",
    "  return { evaluated: true, regions };",
    "};"
  ].join("\n");
  return [
    `/* section-preview-verifier:capture-preview-state:${label} */`,
    `/* screenshot-path:${screenshotAbsolutePath} */`,
    `const screenshotPath = ${JSON.stringify(screenshotAbsolutePath)};`,
    // Wait for the network to settle and for every <img> to finish decoding
    // before screenshotting. Without this, sections with large background
    // assets fetched via /cdn/shop/.../assets/<file>.png screenshot before
    // the image paints, producing artifact PNGs that look empty even though
    // the markup is correct. Failures are non-fatal — slow networks or
    // never-loading images shouldn't block the geometry probe.
    "await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});",
    "await page.evaluate(() => Promise.all(Array.from(document.images).map((img) => img.decode().catch(() => null)))).catch(() => {});",
    "await page.screenshot({ path: screenshotPath, fullPage: true });",
    "const title = await page.title();",
    "const url = page.url();",
    "const pageText = await page.locator('body').innerText().catch(() => '');",
    "const sectionMountCount = await page.locator('[id^=\"shopify-section-\"]').count();",
    presenceProbe,
    `const expectedRegions = ${probePayload};`,
    `const expectedCanvas = ${canvasPayload};`,
    "const regionPresence = await page.evaluate(collectRegionPresence, { expected: expectedRegions, canvas: expectedCanvas }).catch((err) => ({ error: err && err.message ? err.message : String(err), evaluated: false, regions: [] }));",
    `return JSON.stringify({ title, url, pageText, sectionMountCount, screenshotPath: ${JSON.stringify(screenshotRelativePath)}, regionPresence });`
  ].join("\n");
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
  label,
  expectedRegions = [],
  expectedCanvas = null
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
      wrapRunCodeScript(
        capturePreviewStateScript({
          label,
          screenshotAbsolutePath,
          screenshotRelativePath,
          expectedRegions,
          expectedCanvas
        })
      )
    ]
  });

  const summary = parseJsonOutput(output, `capture ${label} section preview state`);
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

function getFigmaBaselines(sectionTask) {
  return {
    desktop: sectionTask.brief?.layout?.desktop?.preview?.path ?? null,
    mobile: sectionTask.brief?.layout?.mobile?.preview?.path ?? null
  };
}

function collectExpectedRegions(sectionTask, breakpoint) {
  const variant = sectionTask?.brief?.layout?.[breakpoint];
  if (!variant) {
    return [];
  }
  const buckets = [
    Array.isArray(variant.readingOrderTextRegions) ? variant.readingOrderTextRegions : [],
    Array.isArray(variant.topTextRegions) ? variant.topTextRegions : [],
    Array.isArray(variant.topImageRegions) ? variant.topImageRegions : []
  ];
  const seen = new Set();
  const result = [];
  for (const bucket of buckets) {
    for (const region of bucket) {
      if (!region || typeof region.sourceNodeId !== "string" || region.sourceNodeId.length === 0) {
        continue;
      }
      if (seen.has(region.sourceNodeId)) {
        continue;
      }
      seen.add(region.sourceNodeId);
      result.push({
        name: typeof region.name === "string" ? region.name : null,
        sourceNodeId: region.sourceNodeId,
        x: typeof region.x === "number" ? region.x : null,
        y: typeof region.y === "number" ? region.y : null,
        width: typeof region.width === "number" ? region.width : null,
        height: typeof region.height === "number" ? region.height : null
      });
    }
  }
  return result;
}

function collectExpectedCanvas(sectionTask, breakpoint) {
  const canvas = sectionTask?.brief?.layout?.[breakpoint]?.canvas;
  if (!canvas || typeof canvas.width !== "number" || typeof canvas.height !== "number") {
    return null;
  }
  return { width: canvas.width, height: canvas.height };
}

// Geometry tolerances expressed as fractions of the section's bounding box.
// Position (x, y): elements may shift up to 10% of the section's width / height
// from the Figma-measured location before being flagged. Size (width, height):
// flex-laid containers naturally vary more than absolute-positioned content, so
// the tolerance is wider at 15%. These defaults catch gross failures (dots in
// the wrong half of the section, content not bottom-anchored on mobile, etc.)
// without false-positive on minor layout drift.
const DEFAULT_GEOMETRY_TOLERANCE = {
  position: 0.10,
  size: 0.15
};

// When a measured text region's rendered height differs from its Figma height
// by more than this ratio, we treat the cause as font-fallback line-wrap drift
// (e.g. design uses Satoshi, project hasn't wired the @font-face yet, system
// sans renders the heading on 1 line instead of 2). Per the fidelity-probes
// scope decision, font wiring is the developer's deferred responsibility — so
// when this is detected on a viewport, we demote *that viewport's* geometry
// violations from failureReasons to artifact-only warnings. Presence failures
// still hard-fail; only matched regions whose coordinates drift are demoted.
//
// Threshold: the larger of expected/observed must be at least 1.6x the
// smaller. That is wide enough to clearly signal a missing line of wrap (a
// 2-line heading rendered as 1-line is roughly a 2x ratio) without firing on
// minor flex sizing differences.
const FONT_FALLBACK_HEIGHT_RATIO = 1.6;

function detectFontFallback(viewport) {
  const presence = viewport?.regionPresence;
  if (!presence || presence.evaluated !== true || !Array.isArray(presence.regions)) {
    return null;
  }
  for (const region of presence.regions) {
    if (region.matched !== true || region.geometryEvaluated !== true) {
      continue;
    }
    const expected = region.expectedNormalized?.height;
    const observed = region.observedNormalized?.height;
    if (typeof expected !== "number" || typeof observed !== "number") {
      continue;
    }
    if (expected <= 0 || observed <= 0) {
      continue;
    }
    const ratio = expected > observed ? expected / observed : observed / expected;
    if (ratio >= FONT_FALLBACK_HEIGHT_RATIO) {
      return {
        sourceNodeId: region.sourceNodeId ?? region.name ?? "<unnamed>",
        expectedHeight: expected,
        observedHeight: observed,
        ratio
      };
    }
  }
  return null;
}

function evaluateGeometryFailure(region, tolerance = DEFAULT_GEOMETRY_TOLERANCE) {
  if (!region || region.matched !== true || region.geometryEvaluated !== true) {
    return null;
  }
  const delta = region.delta;
  if (!delta) {
    return null;
  }
  const violations = [];
  if (delta.x > tolerance.position) {
    violations.push(`x off by ${(delta.x * 100).toFixed(1)}% (limit ${(tolerance.position * 100).toFixed(0)}%)`);
  }
  if (delta.y > tolerance.position) {
    violations.push(`y off by ${(delta.y * 100).toFixed(1)}% (limit ${(tolerance.position * 100).toFixed(0)}%)`);
  }
  if (delta.width > tolerance.size) {
    violations.push(`width off by ${(delta.width * 100).toFixed(1)}% (limit ${(tolerance.size * 100).toFixed(0)}%)`);
  }
  if (delta.height > tolerance.size) {
    violations.push(`height off by ${(delta.height * 100).toFixed(1)}% (limit ${(tolerance.size * 100).toFixed(0)}%)`);
  }
  if (violations.length === 0) {
    return null;
  }
  const id = region.sourceNodeId ?? region.name ?? "<unnamed>";
  return `${id} (${violations.join("; ")})`;
}

function summarizeRegionPresenceFailures(viewport) {
  const presence = viewport?.regionPresence;
  if (!presence || presence.evaluated !== true || !Array.isArray(presence.regions)) {
    return { missing: [], geometryViolations: [], fontFallbackDetected: null };
  }
  const missing = presence.regions.filter((region) => region.matched !== true);
  const fontFallbackDetected = detectFontFallback(viewport);
  const geometryViolations = [];
  for (const region of presence.regions) {
    const failure = evaluateGeometryFailure(region);
    if (failure) {
      geometryViolations.push(failure);
    }
  }
  return { missing, geometryViolations, fontFallbackDetected };
}

function buildSectionPreviewResult({ summary, artifactPath }) {
  return {
    status: "pending-human-review",
    templatePath: summary.previewTemplatePath,
    view: summary.view,
    previewUrl: summary.previewUrl,
    artifactPath,
    figmaBaselines: summary.figmaBaselines,
    runtimeScreenshots: {
      desktop: summary.desktop.screenshotPath,
      mobile: summary.mobile.screenshotPath
    }
  };
}

export async function verifySectionPreview({
  rootDir,
  outputDir = path.join(rootDir, "starter", "theme"),
  sectionTaskPath,
  resultPath,
  pwcliBin = process.env.PWCLI_BIN || DEFAULT_PWCLI_BIN,
  env = {},
  skipPreflight = false
}) {
  const sectionTask = await readJson(sectionTaskPath);
  const provenanceError = getBriefProvenanceError(sectionTask);
  if (provenanceError) {
    throw new Error(`brief provenance contract: ${provenanceError}`);
  }

  // Preflight: gate on bootstrap + deps + build + storefront-dev. agentFixable=true
  // codes throw SectionPreviewBlocker so callers (and `make verify-section-preview`)
  // surface the exact remediation command instead of opening Playwright against a
  // dead storefront. skipPreflight=true is for the narrow case where the caller has
  // already proven environment readiness and wants to drive verify directly (e.g.
  // tests). Returns a dynamicPort that overrides the host:port of browser config URLs.
  let preflight = null;
  if (!skipPreflight) {
    preflight = await preflightSectionPreview({
      rootDir,
      pageKey: sectionTask.pageKey
    });
  }

  const resolvedResultPath = resultPath
    ? path.resolve(resultPath)
    : path.join(outputDir, sectionTask.expectedResultPath);
  const browserConfigPath = path.join(rootDir, "harness", "config", "browser-verification.json");
  const browserConfig = await readJson(browserConfigPath);
  const templateSummary = await createSectionPreview({
    outputDir,
    sectionTaskPath,
    projectRoot: rootDir,
    resultPath: resolvedResultPath
  });
  const descriptor = getSectionPreviewDescriptor(sectionTask);
  const configuredUrl = browserConfig[descriptor.routeKey];
  if (!configuredUrl) {
    throw new Error(`Missing browser verification URL for route key: ${descriptor.routeKey}`);
  }

  // Override the host:port of the configured URL with the live storefront-dev port
  // when storefront-dev is the source-of-truth. This handles the increment-fallback
  // case where storefront-dev landed on a different port than browser-verification.json declares.
  const dynamicallyAdjustedUrl = applyDynamicPort(configuredUrl, preflight?.dynamicPort ?? null);
  const previewUrl = withPreviewView(dynamicallyAdjustedUrl, descriptor.view);
  const session = browserSessionName({
    pageKey: sectionTask.pageKey,
    sectionId: sectionTask.sectionId
  });
  const screenshotDir = path.join(
    rootDir,
    "output",
    "playwright",
    "section-previews",
    sectionTask.pageKey,
    sectionTask.sectionId
  );
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
  const detection = parseJsonOutput(detectionOutput, "section preview password gate detection");
  const passwordPageDetected = detection.passwordRequired === true;
  let passwordSubmitted = false;

  if (passwordPageDetected) {
    if (!browserConfig.storefrontPassword) {
      throw new Error(`Section preview route requires a storefront password for ${sectionTask.sectionId}, but no storefront password is configured.`);
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
    parseJsonOutput(submitOutput, "section preview password submission");
    passwordSubmitted = true;
  }

  const desktop = await verifyViewport({
    pwcliBin,
    session,
    cwd: rootDir,
    env,
    rootDir,
    width: browserConfig.desktopViewport.width,
    height: browserConfig.desktopViewport.height,
    screenshotAbsolutePath: path.join(screenshotDir, "desktop.png"),
    screenshotRelativePath: path.posix.join(
      "output",
      "playwright",
      "section-previews",
      sectionTask.pageKey,
      sectionTask.sectionId,
      "desktop.png"
    ),
    label: "desktop",
    expectedRegions: collectExpectedRegions(sectionTask, "desktop"),
    expectedCanvas: collectExpectedCanvas(sectionTask, "desktop")
  });
  const mobile = await verifyViewport({
    pwcliBin,
    session,
    cwd: rootDir,
    env,
    rootDir,
    width: browserConfig.mobileViewport.width,
    height: browserConfig.mobileViewport.height,
    screenshotAbsolutePath: path.join(screenshotDir, "mobile.png"),
    screenshotRelativePath: path.posix.join(
      "output",
      "playwright",
      "section-previews",
      sectionTask.pageKey,
      sectionTask.sectionId,
      "mobile.png"
    ),
    label: "mobile",
    expectedRegions: collectExpectedRegions(sectionTask, "mobile"),
    expectedCanvas: collectExpectedCanvas(sectionTask, "mobile")
  });

  const failureReasons = [];
  if (isShopifyUploadErrorState(desktop) || isShopifyUploadErrorState(mobile)) {
    failureReasons.push("section preview rendered a Shopify upload error page");
  }
  if (normalizeCount(desktop.sectionMountCount) < 1) {
    failureReasons.push("desktop mounted section count is lower than 1");
  }
  if (normalizeCount(mobile.sectionMountCount) < 1) {
    failureReasons.push("mobile mounted section count is lower than 1");
  }

  // Region presence + geometry probes: when the brief carries measured regions
  // (sourceNodeId set) and a canvas, the implementation must annotate matching
  // DOM elements with data-kik-region="<id>" (presence) and the rendered DOM
  // bounding boxes must fall within tolerance of the measured Figma regions
  // (geometry). Gated to fidelity.mode === "css-1-to-1" so legacy bundle flows
  // that do not yet populate sourceNodeId are unaffected.
  const fidelityMode = sectionTask?.fidelity?.mode;
  const geometryWarnings = [];
  if (fidelityMode === "css-1-to-1") {
    const desktopFindings = summarizeRegionPresenceFailures(desktop);
    const mobileFindings = summarizeRegionPresenceFailures(mobile);
    if (desktopFindings.missing.length > 0) {
      const ids = desktopFindings.missing.map((r) => r.sourceNodeId ?? r.name).join(", ");
      failureReasons.push(
        `desktop preview is missing data-kik-region annotations for measured brief regions: ${ids}`
      );
    }
    if (mobileFindings.missing.length > 0) {
      const ids = mobileFindings.missing.map((r) => r.sourceNodeId ?? r.name).join(", ");
      failureReasons.push(
        `mobile preview is missing data-kik-region annotations for measured brief regions: ${ids}`
      );
    }
    for (const [breakpoint, findings] of [["desktop", desktopFindings], ["mobile", mobileFindings]]) {
      if (findings.geometryViolations.length === 0) {
        continue;
      }
      const message = `${breakpoint} preview region geometry exceeds tolerance: ${findings.geometryViolations.join("; ")}`;
      if (findings.fontFallbackDetected) {
        // Font wiring is the developer's deferred responsibility per the
        // fidelity-probes scope decision. When a viewport's text region shows
        // a height ratio >= 1.6x against the brief, line-wrap differences from
        // a missing webfont cascade into position deltas across the whole
        // stack — we record those deltas as warnings rather than failing the
        // run so font setup can proceed without blocking section delivery.
        const fb = findings.fontFallbackDetected;
        geometryWarnings.push({
          breakpoint,
          reason: "font-fallback",
          trigger: {
            sourceNodeId: fb.sourceNodeId,
            expectedHeight: fb.expectedHeight,
            observedHeight: fb.observedHeight,
            ratio: fb.ratio
          },
          message
        });
      } else {
        failureReasons.push(message);
      }
    }
  }

  const artifactRelativePath = path.posix.join(
    "agent",
    "section-previews",
    `${sectionTask.pageKey}.${sectionTask.sectionId}.preview.json`
  );
  const artifactPath = path.join(outputDir, artifactRelativePath);
  const summary = {
    pageKey: sectionTask.pageKey,
    sectionId: sectionTask.sectionId,
    routeKey: descriptor.routeKey,
    view: descriptor.view,
    previewTemplatePath: templateSummary.templatePath,
    previewUrl,
    passwordPageDetected,
    passwordSubmitted,
    desktop,
    mobile,
    figmaBaselines: getFigmaBaselines(sectionTask),
    visualReviewStatus: "pending-human-review",
    status: failureReasons.length > 0 ? "failed" : "passed",
    ...(failureReasons.length > 0 ? { failureReasons } : {}),
    ...(geometryWarnings.length > 0 ? { geometryWarnings } : {})
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
    sectionPreview: buildSectionPreviewResult({
      summary,
      artifactPath: artifactRelativePath
    })
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
  try {
    const summary = await verifySectionPreview({
      rootDir,
      outputDir,
      sectionTaskPath,
      resultPath
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    if (error instanceof SectionPreviewBlocker) {
      process.stdout.write(
        `${JSON.stringify(
          {
            status: "blocked",
            code: error.code,
            agentFixable: error.agentFixable,
            message: error.message,
            remediation: error.remediation,
            detail: error.detail
          },
          null,
          2
        )}\n`
      );
      process.exit(error.agentFixable ? 2 : 3);
    }
    throw error;
  }
}
