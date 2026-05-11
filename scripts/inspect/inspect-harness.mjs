import fs from "node:fs/promises";
import path from "node:path";

import { discoverFigmaPageBundles, loadFigmaPageBundle } from "../../harness/compiler/load-figma-bundles.mjs";
import { isMainModule } from "../../harness/shared/is-main-module.mjs";
import { tryResolvePageKey } from "../../harness/shared/resolve-page-key.mjs";

export const LEGACY_SOURCE_MANIFEST_FILE = "source-manifest.json";

export function buildLegacySourceManifestMessage(resolvedPageKey) {
  const pageKeyHint = resolvedPageKey ?? "<page-key>";
  return (
    `Legacy root source-manifest.json detected. ` +
    `Move it to figma/${pageKeyHint}/source-manifest.json and add a pageKey="${pageKeyHint}" field. ` +
    `See docs/plans/2026-05-08-source-manifest-page-key-isolation-implementation-plan.md.`
  );
}

export async function detectLegacySourceManifest({ rootDir }) {
  const legacyPath = path.join(rootDir, LEGACY_SOURCE_MANIFEST_FILE);
  if (!(await pathExists(legacyPath))) {
    return null;
  }
  const resolved = tryResolvePageKey({ rootDir });
  const resolvedPageKey = resolved.ok ? resolved.pageKey : null;
  return {
    path: LEGACY_SOURCE_MANIFEST_FILE,
    resolvedPageKey,
    message: buildLegacySourceManifestMessage(resolvedPageKey)
  };
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readOptionalJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function expectedTemplatePath(pageKey, surfaceType) {
  if (surfaceType === "global") {
    return null;
  }
  if (surfaceType === "product") {
    return path.join("templates", `product.${pageKey}.json`);
  }
  if (surfaceType === "cart") {
    return path.join("templates", `cart.${pageKey}.json`);
  }
  return path.join("templates", `page.${pageKey}.json`);
}

async function readTextOptional(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function listFilesRecursive(directory, predicate) {
  const out = [];
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return out;
    }
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const inner = await listFilesRecursive(fullPath, predicate);
      out.push(...inner);
    } else if (entry.isFile() && predicate(entry.name)) {
      out.push(fullPath);
    }
  }
  return out;
}

function extractFontFamilyTokenDeclarations(inputCss) {
  if (!inputCss) {
    return [];
  }
  const declarations = [];
  const regex = /--(kik-text-font-[a-z0-9-]+)\s*:\s*([^;]+);/gi;
  let match;
  while ((match = regex.exec(inputCss)) !== null) {
    const family = match[2]
      .replace(/!important/i, "")
      .trim()
      .split(",")[0]
      .replace(/^['"]|['"]$/g, "")
      .trim();
    if (family) {
      declarations.push({ token: match[1], family });
    }
  }
  // De-duplicate by token+family pair.
  const seen = new Set();
  return declarations.filter((entry) => {
    const key = `${entry.token}::${entry.family}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function fontFaceFamiliesIn(cssText) {
  if (!cssText) {
    return new Set();
  }
  const families = new Set();
  const regex = /@font-face\s*{[^}]*?font-family\s*:\s*([^;}]+)[;}]/gi;
  let match;
  while ((match = regex.exec(cssText)) !== null) {
    const family = match[1]
      .replace(/!important/i, "")
      .trim()
      .split(",")[0]
      .replace(/^['"]|['"]$/g, "")
      .trim();
    if (family) {
      families.add(family.toLowerCase());
    }
  }
  return families;
}

function fontPickerFamiliesIn(jsonText) {
  if (!jsonText) {
    return new Set();
  }
  // Best-effort scan for font_picker bindings; we only need to know that some setting expects to satisfy the family at runtime.
  const families = new Set();
  const regex = /"font_picker"|"type"\s*:\s*"font"/g;
  if (regex.test(jsonText)) {
    families.add("__font_picker_present__");
  }
  return families;
}

async function summarizeFontSources({ rootDir }) {
  const inputCssPath = path.join(rootDir, "src", "input.css");
  const inputCss = await readTextOptional(inputCssPath);
  const declarations = extractFontFamilyTokenDeclarations(inputCss);
  if (declarations.length === 0) {
    return {
      inputCssPresent: inputCss !== null,
      tokens: [],
      summary: inputCss === null ? "src/input.css missing" : "no --kik-text-font-* tokens declared"
    };
  }

  const cssFiles = [
    ...(await listFilesRecursive(path.join(rootDir, "src"), (name) => name.endsWith(".css"))),
    ...(await listFilesRecursive(path.join(rootDir, "assets"), (name) => name.endsWith(".css")))
  ];
  const fontFaceFamilies = new Set();
  for (const file of cssFiles) {
    const cssText = await readTextOptional(file);
    for (const family of fontFaceFamiliesIn(cssText)) {
      fontFaceFamilies.add(family);
    }
  }

  const settingsSchema = await readTextOptional(path.join(rootDir, "config", "settings_schema.json"));
  const fontPicker = fontPickerFamiliesIn(settingsSchema);

  const tokens = declarations.map((entry) => {
    const familyKey = entry.family.toLowerCase();
    const isSystem = ["system-ui", "sans-serif", "serif", "monospace", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded"].includes(
      familyKey
    );
    const hasFontFace = fontFaceFamilies.has(familyKey);
    const hasFontPicker = fontPicker.has("__font_picker_present__");
    let status;
    if (isSystem) {
      status = "system-family";
    } else if (hasFontFace) {
      status = "font-face";
    } else if (hasFontPicker) {
      status = "font-picker-present";
    } else {
      status = "unsatisfied";
    }
    return { token: entry.token, family: entry.family, status };
  });

  const unsatisfied = tokens.filter((t) => t.status === "unsatisfied");
  return {
    inputCssPresent: true,
    tokens,
    unsatisfiedFamilies: unsatisfied.map((t) => t.family),
    summary:
      unsatisfied.length === 0
        ? "all --kik-text-font-* tokens are satisfied"
        : `${unsatisfied.length} font-family token(s) have no @font-face or font_picker source; offline section-preview snapshots will fall back to system sans for: ${unsatisfied
            .map((t) => t.family)
            .join(", ")}`
  };
}

function summarizeAgentTools(config) {
  if (!config) {
    return {
      configured: false,
      configPath: "harness/config/agent-tools.json"
    };
  }

  return {
    configured: true,
    configPath: "harness/config/agent-tools.json",
    shopify: {
      storeDomain: config.shopify?.storeDomain ?? null
    },
    toolServer: {
      baseUrl: config.toolServer?.baseUrl ?? null,
      authType: config.toolServer?.auth?.type ?? null,
      tokenEnv: config.toolServer?.auth?.tokenEnv ?? null,
      capabilities: {
        shopContext: config.toolServer?.capabilities?.shopContext === true,
        imageUpload: config.toolServer?.capabilities?.imageUpload === true
      },
      routes: config.toolServer?.routes ?? null
    }
  };
}

function parityForDesignSystem({ designSystem, kikTokenSource }) {
  if (!designSystem) {
    return {
      status: "unspecified",
      reason: "bundle does not declare design-system metadata"
    };
  }

  if (!kikTokenSource) {
    return {
      status: "missing-project-token-source",
      reason: "project does not declare kik token-source metadata"
    };
  }

  if (designSystem.tokenSet !== kikTokenSource.tokenSet) {
    return {
      status: "mismatch",
      reason: `bundle token set ${designSystem.tokenSet} does not match project token set ${kikTokenSource.tokenSet}`
    };
  }

  if (designSystem.tokenSourceType !== kikTokenSource.sourceType) {
    return {
      status: "mismatch",
      reason: `bundle token source ${designSystem.tokenSourceType} does not match project token source ${kikTokenSource.sourceType}`
    };
  }

  if (designSystem.variablesHash && kikTokenSource.variablesHash && designSystem.variablesHash !== kikTokenSource.variablesHash) {
    return {
      status: "mismatch",
      reason: "bundle variables hash does not match project token-source hash"
    };
  }

  return {
    status: "matched",
    reason: "bundle design-system metadata matches the current project token source"
  };
}

export async function inspectHarness({
  rootDir,
  outputDir = path.join(rootDir, "starter", "theme")
}) {
  const contractFiles = [
    "harness/contracts/agent/page-task.schema.json",
    "harness/contracts/agent/section-task.schema.json",
    "harness/contracts/agent/section-result.schema.json",
    "harness/contracts/agent/page-verification.schema.json",
    "harness/contracts/agent-tools-config.schema.json",
    "harness/contracts/agent-tools-error-codes.json",
    "harness/contracts/section-notes.schema.json",
    "harness/contracts/section-runtime-deps.json",
    "harness/contracts/preview-blocker-codes.json",
    "harness/contracts/browser-verification-config.schema.json",
    "harness/contracts/kik-token-source.schema.json",
    "harness/contracts/figma-page-bundle.schema.json",
    "harness/contracts/figma-assets-manifest.schema.json",
    "harness/contracts/figma-source-manifest.schema.json",
    "harness/contracts/starter-review-manifest.schema.json",
    "harness/contracts/runtime-profile.schema.json",
    "harness/contracts/theme-project-binding.schema.json"
  ];
  const kikTokenSource = await readOptionalJson(path.join(rootDir, "harness", "config", "kik-token-source.json"));
  const agentToolsConfig = await readOptionalJson(path.join(rootDir, "harness", "config", "agent-tools.json"));
  const bundles = await discoverFigmaPageBundles({ rootDir });
  const pages = [];

  for (const bundleRef of bundles) {
    const bundle = await loadFigmaPageBundle({ rootDir, pageKey: bundleRef.pageKey });
    const generatedSections = await Promise.all(
      bundle.sections.map((section) =>
        pathExists(path.join(outputDir, "sections", `generated-${bundle.pageKey}-${section.id}.liquid`))
      )
    );

    pages.push({
      pageKey: bundle.pageKey,
      pageName: bundle.page.pageName,
      surfaceType: bundle.surfaceType,
      bundleQuality: bundle.bundleQuality,
      bundleConsistency: bundle.bundleConsistency,
      sectionExecution: {
        excludeSectionIds: bundle.sectionExecution?.excludeSectionIds ?? []
      },
      designSystem: bundle.designSystem
        ? {
            ...bundle.designSystem,
            parity: parityForDesignSystem({
              designSystem: bundle.designSystem,
              kikTokenSource
            })
          }
        : null,
      sections: bundle.sections.length,
      sourceSections: bundle.sectionExecution?.sourceSectionCount ?? bundle.sections.length,
      excludedSections:
        (bundle.sectionExecution?.sourceSectionCount ?? bundle.sections.length) - bundle.sections.length,
      previews: bundle.previewCountByBreakpoint,
      generated: {
        sections: generatedSections.filter(Boolean).length,
        template:
          expectedTemplatePath(bundle.pageKey, bundle.surfaceType) === null
            ? true
            : await pathExists(path.join(outputDir, expectedTemplatePath(bundle.pageKey, bundle.surfaceType))),
        reviewManifest: await pathExists(path.join(outputDir, "review", `${bundle.pageKey}.manifest.json`)),
        capturePlan: await pathExists(path.join(outputDir, "review", `${bundle.pageKey}.capture-plan.json`))
      }
    });
  }

  const fontSources = await summarizeFontSources({ rootDir });
  const legacySourceManifest = await detectLegacySourceManifest({ rootDir });

  return {
    rootDir,
    bundleCount: bundles.length,
    contractFiles,
    agentTools: summarizeAgentTools(agentToolsConfig),
    kikTokenSource,
    fontSources,
    pages,
    legacySourceManifest
  };
}

if (isMainModule(import.meta.url)) {
  const summary = await inspectHarness({ rootDir: process.cwd() });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  if (summary.legacySourceManifest) {
    process.stderr.write(`warning: ${summary.legacySourceManifest.message}\n`);
  }
}
