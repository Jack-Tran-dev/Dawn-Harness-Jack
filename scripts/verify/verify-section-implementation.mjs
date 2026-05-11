import fs from "node:fs/promises";
import path from "node:path";

import { isMainModule } from "../../harness/shared/is-main-module.mjs";
import { loadSectionNotes } from "../../harness/shared/load-section-notes.mjs";

const INTERACTION_PATTERN_SIGNALS = {
  carousel: {
    label: "carousel",
    matchers: [
      /\bswiper\b/i,
      /<kik-[a-z-]*(?:carousel|slider|slideshow)\b/i,
      /\bdata-kik-(?:carousel|slider|slideshow)\b/i,
      /\bclass\s*=\s*["'][^"']*\bswiper-(?:container|wrapper|slide)\b/i,
      /\bsnap-x\b/i,
      /\boverflow-x-(?:auto|scroll)\b[\s\S]*?\bsnap-(?:start|center|end)\b/i
    ],
    requirementMessage:
      "expected carousel implementation markers (Swiper.js, a kik-* Custom Element with carousel/slider/slideshow in the tag, data-kik-carousel hook, or scroll-snap utilities)"
  },
  tabs: {
    label: "tabs",
    matchers: [
      /\brole\s*=\s*["']tablist["']/i,
      /\brole\s*=\s*["']tab["']/i,
      /\baria-selected\b/i,
      /<kik-[a-z-]*tabs?\b/i,
      /\bdata-kik-tabs?\b/i
    ],
    requirementMessage:
      "expected tabs implementation markers (role=tablist / role=tab / aria-selected, or a kik-tabs Custom Element / data-kik-tabs hook)"
  },
  accordion: {
    label: "accordion",
    matchers: [
      /<details\b/i,
      /\baria-expanded\b/i,
      /<kik-[a-z-]*accordion\b/i,
      /\bdata-kik-accordion\b/i
    ],
    requirementMessage:
      "expected accordion implementation markers (<details>/<summary>, aria-expanded, kik-accordion Custom Element, or data-kik-accordion hook)"
  }
};

export function sectionImplementationArtifactRelativePath(pageKey) {
  return path.posix.join("agent", `page.${pageKey}.section-implementation.json`);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function splitSectionDocument(content) {
  const schemaMatch = content.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/i);
  return {
    body: schemaMatch ? content.slice(0, schemaMatch.index) : content,
    schemaText: schemaMatch ? schemaMatch[1] : null
  };
}

function parseSchema(schemaText) {
  if (!schemaText) {
    return null;
  }

  try {
    return JSON.parse(schemaText.trim());
  } catch {
    return null;
  }
}

function countMatches(value, pattern) {
  return value.match(pattern)?.length ?? 0;
}

function collectSchemaSettingIds(schema) {
  return Array.isArray(schema?.settings)
    ? schema.settings
      .map((setting) => (typeof setting?.id === "string" ? setting.id : null))
      .filter(Boolean)
    : [];
}

function collectSettingReferences(body) {
  const matches = body.matchAll(/section\.settings\.([a-zA-Z0-9_]+)/g);
  return [...new Set([...matches].map((match) => match[1]).filter(Boolean))];
}

function hasNativeDataBindingUsage(dataBinding, body) {
  if (!dataBinding || typeof dataBinding !== "object") {
    return true;
  }

  if (dataBinding.kind === "product") {
    return /section\.settings\.product\.(featured_image|images|media|variants|price|compare_at_price|url|available|options|metafields)\b/i.test(body);
  }

  if (dataBinding.kind === "collection") {
    return /section\.settings\.collection\.products\b/i.test(body);
  }

  if (dataBinding.kind === "article") {
    return /section\.settings\.blog\.articles\b/i.test(body);
  }

  if (dataBinding.kind === "metaobject") {
    return /shop\.metaobjects\b/i.test(body) && /section\.settings\.metaobject_type\b/i.test(body);
  }

  return false;
}

async function checkInteractionPatternImplementation({ rootDir, pageKey, sectionId, content }) {
  const loaded = await loadSectionNotes({ rootDir, pageKey });
  if (loaded.loadError) {
    return { error: `harness/notes/${pageKey}.json could not be parsed: ${loaded.loadError.message}` };
  }
  if (!loaded.present) {
    return { error: null };
  }
  const notes = loaded.lookupBySectionId(sectionId);
  const declaredPattern = notes?.implementationPolicy?.pattern;
  if (!declaredPattern || declaredPattern === "static" || declaredPattern === "custom") {
    return { error: null };
  }
  const signal = INTERACTION_PATTERN_SIGNALS[declaredPattern];
  if (!signal) {
    return { error: null };
  }
  const matched = signal.matchers.some((pattern) => pattern.test(content));
  if (matched) {
    return { error: null };
  }
  return {
    error: `harness/notes/${pageKey}.json declares implementationPolicy.pattern=${declaredPattern} for this section, but the section file has no ${signal.label} markup. ${signal.requirementMessage}.`
  };
}

function analyzeSectionImplementation(content, sectionTask = null) {
  const { body, schemaText } = splitSectionDocument(content);
  const schema = parseSchema(schemaText);
  const normalizedBody = body
    .replace(/{%[\s\S]*?%}/g, " ")
    .replace(/{{[\s\S]*?}}/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");

  const imageTagCount = countMatches(normalizedBody, /<img\b/gi);
  const pictureTagCount = countMatches(normalizedBody, /<picture\b/gi);
  const sourceTagCount = countMatches(normalizedBody, /<source\b/gi);
  const interactiveTagCount = countMatches(
    normalizedBody,
    /<(a|button|input|select|textarea|summary|details|video)\b/gi
  );
  const textContainerTagCount = countMatches(
    normalizedBody,
    /<(h[1-6]|p|ul|ol|li|blockquote|figcaption|label)\b/gi
  );
  const schemaSettingCount = Array.isArray(schema?.settings) ? schema.settings.length : 0;
  const schemaBlockCount = Array.isArray(schema?.blocks) ? schema.blocks.length : 0;
  const schemaSettingIds = collectSchemaSettingIds(schema);
  const settingReferences = collectSettingReferences(body);
  const expectedSettingIds = Array.isArray(sectionTask?.templateContract?.allowedSettingIds)
    ? sectionTask.templateContract.allowedSettingIds
    : [];
  const unexpectedSchemaSettingIds =
    expectedSettingIds.length > 0
      ? schemaSettingIds.filter((settingId) => !expectedSettingIds.includes(settingId))
      : [];
  const hasMeaningfulSchemaSurface = schemaSettingCount > 0 || schemaBlockCount > 0;
  const remoteImageUrlDetected =
    /(?:src|srcset)\s*=\s*["']https?:\/\//i.test(body) ||
    /assign\s+[a-zA-Z0-9_]+\s*=\s*['"]https?:\/\//i.test(body);
  const missingSchemaSettingIds = expectedSettingIds.filter((settingId) => !schemaSettingIds.includes(settingId));
  const missingMarkupReferences = expectedSettingIds.filter((settingId) => !settingReferences.includes(settingId));
  const nativeDataBindingUsageDetected = hasNativeDataBindingUsage(sectionTask?.dataBinding, body);

  const screenshotBaselineDetected =
    imageTagCount === 1 &&
    pictureTagCount <= 1 &&
    sourceTagCount <= 1 &&
    interactiveTagCount === 0 &&
    textContainerTagCount === 0 &&
    !hasMeaningfulSchemaSurface;

  return {
    screenshotBaselineDetected,
    remoteImageUrlDetected,
    missingSchemaSettingIds,
    unexpectedSchemaSettingIds,
    missingMarkupReferences,
    nativeDataBindingUsageDetected,
    metrics: {
      imageTagCount,
      pictureTagCount,
      sourceTagCount,
      interactiveTagCount,
      textContainerTagCount,
      schemaSettingCount,
      schemaBlockCount,
      schemaSettingIds,
      settingReferences
    }
  };
}

export async function verifySectionImplementation({
  rootDir,
  outputDir,
  pageTaskPath
}) {
  const pageTask = await readJson(pageTaskPath);
  const verifiedSections = [];
  const blockedSections = [];
  const openIssues = [];
  const analyses = [];

  if (pageTask.surfaceType === "global") {
    const summary = {
      pageKey: pageTask.pageKey,
      surfaceType: pageTask.surfaceType,
      verifiedSections,
      blockedSections,
      openIssues,
      analyses,
      status: "passed"
    };

    await writeJson(path.join(outputDir, sectionImplementationArtifactRelativePath(pageTask.pageKey)), summary);
    return summary;
  }

  for (const section of pageTask.sections ?? []) {
    const sectionTaskPath = path.join(outputDir, section.sectionTaskPath);
    const sectionTask = await readJson(sectionTaskPath);
    const sectionFilePath = path.join(rootDir, sectionTask.implementationTarget.sectionFile);

    let content = null;
    try {
      content = await fs.readFile(sectionFilePath, "utf8");
    } catch (error) {
      blockedSections.push(section.sectionId);
      openIssues.push(`${section.sectionId}: missing section implementation file at ${sectionTask.implementationTarget.sectionFile}`);
      continue;
    }

    const analysis = analyzeSectionImplementation(content, sectionTask);
    analyses.push({
      sectionId: section.sectionId,
      implementationPath: sectionTask.implementationTarget.sectionFile,
      ...analysis
    });

    if (analysis.screenshotBaselineDetected) {
      blockedSections.push(section.sectionId);
      openIssues.push(
        `${section.sectionId}: section renders as a single responsive image baseline with no meaningful schema or content structure`
      );
      continue;
    }

    if (analysis.remoteImageUrlDetected) {
      blockedSections.push(section.sectionId);
      openIssues.push(`${section.sectionId}: section hardcodes absolute remote image URLs instead of theme-owned assets`);
      continue;
    }

    if (analysis.missingSchemaSettingIds.length > 0) {
      blockedSections.push(section.sectionId);
      openIssues.push(
        `${section.sectionId}: section is missing expected schema setting ids from the template contract (${analysis.missingSchemaSettingIds.join(", ")})`
      );
      continue;
    }

    if (analysis.unexpectedSchemaSettingIds.length > 0) {
      blockedSections.push(section.sectionId);
      openIssues.push(
        `${section.sectionId}: section adds unexpected schema setting ids outside the template contract (${analysis.unexpectedSchemaSettingIds.join(", ")})`
      );
      continue;
    }

    if (analysis.missingMarkupReferences.length > 0) {
      blockedSections.push(section.sectionId);
      openIssues.push(
        `${section.sectionId}: section does not reference expected template contract settings in markup (${analysis.missingMarkupReferences.join(", ")})`
      );
      continue;
    }

    if (sectionTask.dataBinding && !analysis.nativeDataBindingUsageDetected) {
      blockedSections.push(section.sectionId);
      openIssues.push(
        `${section.sectionId}: data-bound section does not render from the native Shopify data source declared by section-task.dataBinding`
      );
      continue;
    }

    const interactionGate = await checkInteractionPatternImplementation({
      rootDir,
      pageKey: pageTask.pageKey,
      sectionId: section.sectionId,
      content
    });
    if (interactionGate.error) {
      blockedSections.push(section.sectionId);
      openIssues.push(`${section.sectionId}: ${interactionGate.error}`);
      continue;
    }

    verifiedSections.push(section.sectionId);
  }

  const summary = {
    pageKey: pageTask.pageKey,
    surfaceType: pageTask.surfaceType,
    verifiedSections,
    blockedSections,
    openIssues,
    analyses,
    status: blockedSections.length > 0 ? "blocked" : "passed"
  };

  await writeJson(path.join(outputDir, sectionImplementationArtifactRelativePath(pageTask.pageKey)), summary);
  return summary;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const rootDir = args[0] ? path.resolve(args[0]) : process.cwd();
  const outputDir = args[1] ? path.resolve(args[1]) : path.join(process.cwd(), "starter", "theme");
  const pageTaskPath = args[2]
    ? path.resolve(args[2])
    : path.join(outputDir, "agent", "page.home.task.json");
  const summary = await verifySectionImplementation({ rootDir, outputDir, pageTaskPath });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
