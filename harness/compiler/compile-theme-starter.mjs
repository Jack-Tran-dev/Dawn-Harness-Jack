import fs from "node:fs/promises";
import path from "node:path";

import { discoverFigmaPageBundles, loadFigmaPageBundle } from "./load-figma-bundles.mjs";
import { isMainModule } from "../shared/is-main-module.mjs";
import { buildFidelityEvidence } from "../runtime/build-fidelity-mask.mjs";
import { buildSectionBrief } from "./section-brief.mjs";
import { DEFAULT_MAX_ATTEMPTS_PER_SECTION, retryLedgerRelativePath } from "../shared/retry-ledger.mjs";

function sectionFileStem(pageKey, sectionId) {
  return `generated-${pageKey}-${sectionId}`;
}

function normalizeTemplateIdSegment(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
}

function templateSectionId(pageKey, slotIndex) {
  const normalizedPageKey = normalizeTemplateIdSegment(pageKey) || "page";
  return `${normalizedPageKey}-section-${String(slotIndex).padStart(2, "0")}`;
}

function implementationSectionFile(pageKey, section) {
  const reusableFamilyKey =
    typeof section.implementationFamily?.key === "string"
      ? normalizeTemplateIdSegment(section.implementationFamily.key)
      : null;
  if (reusableFamilyKey) {
    return path.posix.join("sections", `kik-${reusableFamilyKey}.liquid`);
  }

  const normalizedPageKey = normalizeTemplateIdSegment(pageKey) || "page";
  const normalizedSectionId = normalizeTemplateIdSegment(section.id) || "section";
  return path.posix.join("sections", `kik-${normalizedPageKey}-${normalizedSectionId}.liquid`);
}

function deliveryTemplatePath(pageKey, surfaceType) {
  if (surfaceType === "global") {
    return null;
  }
  if (surfaceType === "product") {
    return path.posix.join("templates", `product.${pageKey}.json`);
  }
  if (surfaceType === "cart") {
    return path.posix.join("templates", `cart.${pageKey}.json`);
  }
  return path.posix.join("templates", `page.${pageKey}.json`);
}

function previewUrlForSurfaceType(surfaceType) {
  if (surfaceType === "product") {
    return "http://127.0.0.1:9292/products/example-product?view=kik-preview";
  }
  if (surfaceType === "cart") {
    return "http://127.0.0.1:9292/cart?view=kik-preview";
  }
  return "http://127.0.0.1:9292/?view=kik-preview";
}

function previewRouteKeyForSurfaceType(surfaceType) {
  if (surfaceType === "product") {
    return "productPreviewUrl";
  }
  if (surfaceType === "cart") {
    return "cartPreviewUrl";
  }
  return "pagePreviewUrl";
}

function escapeLiquidString(value) {
  return value.replace(/"/g, '\\"');
}

function generatedSectionSchemaName(pageKey, section) {
  const prefix = `${normalizeTemplateIdSegment(pageKey) || "page"} s${String(section.slotIndex).padStart(2, "0")}`;
  const remaining = 25 - prefix.length - 1;
  const sectionName = String(section.name || "section").replace(/\s+/g, " ").trim();

  if (remaining <= 0 || sectionName.length === 0) {
    return prefix.slice(0, 25);
  }

  const suffix = sectionName.slice(0, remaining).trimEnd();
  return `${prefix} ${suffix}`.slice(0, 25);
}

function buildSettingDefinitions(section) {
  if (section.dataBinding?.kind === "product") {
    return [
      {
        type: "product",
        id: "product",
        label: "Product"
      }
    ];
  }

  if (section.dataBinding?.kind === "collection") {
    return [
      {
        type: "collection",
        id: "collection",
        label: "Collection"
      },
      {
        type: "range",
        id: "limit",
        label: "Limit",
        min: 1,
        max: 24,
        step: 1,
        default: section.dataBinding.limit ?? 4
      }
    ];
  }

  if (section.dataBinding?.kind === "article") {
    return [
      {
        type: "blog",
        id: "blog",
        label: "Blog"
      },
      {
        type: "range",
        id: "limit",
        label: "Limit",
        min: 1,
        max: 24,
        step: 1,
        default: section.dataBinding.limit ?? 4
      }
    ];
  }

  if (section.dataBinding?.kind === "metaobject") {
    return [
      {
        type: "text",
        id: "metaobject_type",
        label: "Metaobject Type",
        default: section.dataBinding.type
      }
    ];
  }

  const defaults = section.textDefaults;
  const base = [
    {
      type: "text",
      id: "heading",
      label: "Heading",
      default: defaults[0] || section.name
    },
    {
      type: "textarea",
      id: "body",
      label: "Body",
      default: defaults[1] || "Implement the Figma layout for this section."
    }
  ];

  if (defaults[2]) {
    base.push({
      type: "text",
      id: "primary_cta_label",
      label: "Primary CTA Label",
      default: defaults[2]
    });
  }

  if (defaults[3]) {
    base.push({
      type: "text",
      id: "secondary_cta_label",
      label: "Secondary CTA Label",
      default: defaults[3]
    });
  }

  return base;
}

function implementationSectionType(pageKey, section) {
  return path.posix.basename(implementationSectionFile(pageKey, section), ".liquid");
}

function buildTemplateContract(pageKey, section) {
  return {
    sectionType: implementationSectionType(pageKey, section),
    allowedSettingIds: buildSettingDefinitions(section).map((setting) => setting.id),
    blockPolicy: section.implementationPolicy.repeatedContentSource === "blocks" ? "open" : "forbidden"
  };
}

function buildFigmaSourceInput(section) {
  const desktop = section.source?.desktop?.figma ?? section.variants.desktop?.source?.figma;
  const mobile = section.source?.mobile?.figma ?? section.variants.mobile?.source?.figma;

  if (!desktop && !mobile) {
    return null;
  }

  return {
    ...(desktop ? { desktop } : {}),
    ...(mobile ? { mobile } : {})
  };
}

function buildLiquidSection({ pageKey, section }) {
  const fileStem = sectionFileStem(pageKey, section.id);
  const templateId = templateSectionId(pageKey, section.slotIndex);
  const settings = buildSettingDefinitions(section);
  const metadata = {
    type: fileStem,
    pageKey,
    sectionId: section.id,
    slotIndex: section.slotIndex,
    handle: section.handle,
    source: {
      desktop: section.variants.desktop.source.nodeId,
      mobile: section.variants.mobile.source.nodeId
    }
  };

  const schemaName = generatedSectionSchemaName(pageKey, section);

  const schema = {
    name: schemaName,
    tag: "section",
    class: `harness-section harness-section--${section.handle}`,
    settings,
    presets: [
      {
        name: schemaName
      }
    ]
  };

  return `{% comment %}
Generated by Shopify Theme Harness Starter.
${JSON.stringify(metadata, null, 2)}
{% endcomment %}
<section class="harness-section harness-section--${section.handle}" data-harness-page="${pageKey}" data-harness-section="${section.id}" data-harness-slot="${section.slotIndex}">
  <div class="harness-section__inner">
    <h2>{{ section.settings.heading | default: "${escapeLiquidString(settings.find((setting) => typeof setting.default === "string")?.default ?? section.name)}" }}</h2>
    <div class="harness-section__meta">
      <p>Implement the restored Shopify markup for <strong>${section.name}</strong>.</p>
      <p>Template section id: <code>${templateId}</code></p>
    </div>
    <div class="harness-section__review">
      <p>Desktop source node: ${section.variants.desktop.source.nodeId}</p>
      <p>Mobile source node: ${section.variants.mobile.source.nodeId}</p>
    </div>
  </div>
</section>

{% schema %}
${JSON.stringify(schema, null, 2)}
{% endschema %}
`;
}

function buildTemplate(pageKey, sections) {
  const template = {
    sections: {},
    order: []
  };

  for (const section of sections) {
    const templateId = templateSectionId(pageKey, section.slotIndex);
    const fileStem = sectionFileStem(pageKey, section.id);
    template.sections[templateId] = {
      type: fileStem,
      settings: {}
    };
    template.order.push(templateId);
  }

  return template;
}

function buildReviewManifest(pageKey, bundle) {
  return {
    pageKey,
    pageName: bundle.page.pageName,
    surfaceType: bundle.surfaceType,
    sharedSurfaceKeys: bundle.sharedSurfaceKeys,
    templatePath: deliveryTemplatePath(pageKey, bundle.surfaceType),
    sections: bundle.sections.map((section) => ({
      id: section.id,
      name: section.name,
      handle: section.handle,
      slotIndex: section.slotIndex,
      templateSectionId: templateSectionId(pageKey, section.slotIndex),
      sectionFile: path.posix.join("sections", `${sectionFileStem(pageKey, section.id)}.liquid`),
      previews: {
        desktop: section.variants.desktop.preview.relativePath,
        mobile: section.variants.mobile.preview.relativePath
      },
      source: section.source
    }))
  };
}

function buildCapturePlan(pageKey, bundle) {
  return {
    pageKey,
    surfaceType: bundle.surfaceType,
    sectionExecution: {
      excludeSectionIds: bundle.sectionExecution?.excludeSectionIds ?? []
    },
    captures: bundle.sections.flatMap((section) => [
      {
        sectionId: section.id,
        breakpoint: "desktop",
        sourcePreviewPath: section.variants.desktop.preview.relativePath,
        expectedCapturePath: path.posix.join("runtime", "captures", pageKey, `${section.id}.desktop.png`),
        fidelityEvidence: buildFidelityEvidence({
          fidelity: bundle.fidelity,
          variant: section.variants.desktop
        })
      },
      {
        sectionId: section.id,
        breakpoint: "mobile",
        sourcePreviewPath: section.variants.mobile.preview.relativePath,
        expectedCapturePath: path.posix.join("runtime", "captures", pageKey, `${section.id}.mobile.png`),
        fidelityEvidence: buildFidelityEvidence({
          fidelity: bundle.fidelity,
          variant: section.variants.mobile
        })
      }
    ])
  };
}

function buildRuntimeProfile(pages) {
  return {
    pageCount: pages.length,
    pages: pages.map((page) => ({
      pageKey: page.pageKey,
      pageName: page.pageName,
      surfaceType: page.surfaceType,
      templatePath: page.templatePath,
      captureCount: page.captures.length,
      captures: page.captures
    }))
  };
}

function buildThemeProjectBindingExample(pageKeys) {
  return {
    captureSourceDir: "",
    capturePathStyle: "flat",
    pageKeys,
    notes: "Copy this file to theme-project.binding.json and point captureSourceDir at your real theme screenshot output directory."
  };
}

async function buildAgentSectionTask({ rootDir, pageKey, surfaceType, fidelity, section, sectionIndex, captureSlots }) {
  const figmaSource = buildFigmaSourceInput(section);

  return {
    pageKey,
    profile: "kik",
    surfaceType,
    sectionId: section.id,
    sectionKey: section.handle,
    templateSectionId: templateSectionId(pageKey, section.slotIndex),
    expectedResultPath: path.posix.join("agent", "results", `${pageKey}.${section.id}.result.json`),
    implementationTarget: {
      sectionFile: implementationSectionFile(pageKey, section),
      snippetFiles: [],
      previewTemplate: "templates/index.kik-preview.json"
    },
    implementationPolicy: section.implementationPolicy,
    ...(section.dataBinding ? { dataBinding: section.dataBinding } : {}),
    fidelity,
    templateContract: buildTemplateContract(pageKey, section),
    inputs: {
      desktopBundlePath: path.posix.join("figma", pageKey, "sections", `${section.id}.desktop.json`),
      mobileBundlePath: path.posix.join("figma", pageKey, "sections", `${section.id}.mobile.json`),
      ...(section.desktopDetailPath ? { desktopDetailPath: section.desktopDetailPath } : {}),
      ...(section.mobileDetailPath ? { mobileDetailPath: section.mobileDetailPath } : {}),
      ...(figmaSource ? { figmaSource } : {}),
      starterSectionPath: path.posix.join("sections", `${sectionFileStem(pageKey, section.id)}.liquid`),
      reviewManifestSection: path.posix.join("review", `${pageKey}.manifest.json`) + `#/sections/${sectionIndex}`
    },
    brief: await buildSectionBrief({ rootDir, pageKey, section }),
    captureSlots
  };
}

function buildAgentPageTask({ pageKey, surfaceType, sharedSurfaceKeys, fidelity, capturePlan, sectionTasks }) {
  return {
    pageKey,
    profile: "kik",
    surfaceType,
    sharedSurfaceKeys,
    sectionExecution: {
      excludeSectionIds: capturePlan.sectionExecution?.excludeSectionIds ?? []
    },
    pageDispatchPath: path.posix.join("agent", `page.${pageKey}.dispatch.json`),
    pageVerificationPath: path.posix.join("agent", `page.${pageKey}.verification.json`),
    pageRetryLedgerPath: retryLedgerRelativePath(pageKey),
    deliveryTemplatePath: deliveryTemplatePath(pageKey, surfaceType),
    pageBundlePath: path.posix.join("figma", pageKey, "page.json"),
    retryPolicy: {
      maxAttemptsPerSection: DEFAULT_MAX_ATTEMPTS_PER_SECTION
    },
    fidelity,
    reviewManifestPath: path.posix.join("review", `${pageKey}.manifest.json`),
    runtimeProfilePath: path.posix.join("runtime", "runtime-profile.json"),
    preview: {
      template: "templates/index.kik-preview.json",
      url: previewUrlForSurfaceType(surfaceType),
      configPath: "harness/config/browser-verification.json",
      routeKey: previewRouteKeyForSurfaceType(surfaceType)
    },
    sections: sectionTasks.map((task) => ({
      sectionId: task.sectionId,
      sectionKey: task.sectionKey,
      templateSectionId: task.templateSectionId,
      starterSectionPath: task.inputs.starterSectionPath,
      sectionTaskPath: path.posix.join("agent", "sections", `${pageKey}.${task.sectionId}.task.json`),
      expectedResultPath: task.expectedResultPath,
      desktopBundlePath: task.inputs.desktopBundlePath,
      mobileBundlePath: task.inputs.mobileBundlePath,
      ...(task.inputs.desktopDetailPath ? { desktopDetailPath: task.inputs.desktopDetailPath } : {}),
      ...(task.inputs.mobileDetailPath ? { mobileDetailPath: task.inputs.mobileDetailPath } : {}),
      captureSlots: capturePlan.captures
        .filter((capture) => capture.sectionId === task.sectionId)
        .map((capture) => capture.expectedCapturePath)
    }))
  };
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function snapshotPreservedArtifacts(outputDir) {
  const preservedRoots = [
    path.join("agent", "results"),
    path.join("runtime", "captures")
  ];
  const artifacts = [];

  async function walk(relativeDir) {
    const absoluteDir = path.join(outputDir, relativeDir);
    let entries;

    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    for (const entry of entries) {
      const childRelativePath = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        await walk(childRelativePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      artifacts.push({
        relativePath: childRelativePath,
        content: await fs.readFile(path.join(outputDir, childRelativePath))
      });
    }
  }

  for (const relativeRoot of preservedRoots) {
    await walk(relativeRoot);
  }

  return artifacts;
}

async function restorePreservedArtifacts(outputDir, artifacts) {
  for (const artifact of artifacts) {
    const targetPath = path.join(outputDir, artifact.relativePath);
    await ensureDir(path.dirname(targetPath));
    await fs.writeFile(targetPath, artifact.content);
  }
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeStarterReadme(outputDir) {
  const readmePath = path.join(outputDir, "README.md");
  const content = `# Generated Starter Theme Output

This directory contains deterministic starter artifacts generated from Figma page bundles.

- \`sections/generated-*.liquid\` section stubs
- \`templates/page.*.json\`, \`templates/product.*.json\`, and \`templates/cart.*.json\` delivery templates for route-owned surfaces
- \`review/*.manifest.json\` review metadata and source preview links
- \`review/*.capture-plan.json\` expected runtime screenshot slots
`;
  await fs.writeFile(readmePath, content, "utf8");
}

export async function compileThemeStarter({
  rootDir,
  outputDir = path.join(rootDir, "starter", "theme")
}) {
  const bundles = await discoverFigmaPageBundles({ rootDir });
  const preservedArtifacts = await snapshotPreservedArtifacts(outputDir);
  await fs.rm(outputDir, { recursive: true, force: true });
  await ensureDir(path.join(outputDir, "sections"));
  await ensureDir(path.join(outputDir, "templates"));
  await ensureDir(path.join(outputDir, "review"));
  await ensureDir(path.join(outputDir, "agent", "results"));
  await ensureDir(path.join(outputDir, "agent", "sections"));
  await ensureDir(path.join(outputDir, "runtime", "captures"));
  await writeStarterReadme(outputDir);
  await restorePreservedArtifacts(outputDir, preservedArtifacts);

  const pages = [];
  const runtimePages = [];

  for (const bundleRef of bundles) {
    const bundle = await loadFigmaPageBundle({ rootDir, pageKey: bundleRef.pageKey });
    if ((bundle.surfaceType === "page" || bundle.surfaceType === "product" || bundle.surfaceType === "cart") && bundle.bundleQuality?.oneShotEligible === false) {
      throw new Error(
        `Route bundle ${bundle.pageKey} is not one-shot eligible: ${bundle.bundleQuality.issues.join("; ")}`
      );
    }
    const pageKey = bundle.pageKey;
    const templatePath = deliveryTemplatePath(pageKey, bundle.surfaceType);

    for (const section of bundle.sections) {
      const sectionPath = path.join(outputDir, "sections", `${sectionFileStem(pageKey, section.id)}.liquid`);
      await fs.writeFile(sectionPath, buildLiquidSection({ pageKey, section }), "utf8");
    }

    if (templatePath) {
      await writeJson(
        path.join(outputDir, templatePath),
        buildTemplate(pageKey, bundle.sections)
      );
    }
    await writeJson(
      path.join(outputDir, "review", `${pageKey}.manifest.json`),
      buildReviewManifest(pageKey, bundle)
    );
    await writeJson(
      path.join(outputDir, "review", `${pageKey}.capture-plan.json`),
      buildCapturePlan(pageKey, bundle)
    );

    const capturePlan = buildCapturePlan(pageKey, bundle);
    const sectionTasks = await Promise.all(bundle.sections.map((section, sectionIndex) =>
      buildAgentSectionTask({
        rootDir,
        pageKey,
        surfaceType: bundle.surfaceType,
        fidelity: bundle.fidelity,
        section,
        sectionIndex,
        captureSlots: capturePlan.captures
          .filter((capture) => capture.sectionId === section.id)
          .map((capture) => capture.expectedCapturePath)
      })
    ));

    for (const sectionTask of sectionTasks) {
      await writeJson(
        path.join(outputDir, "agent", "sections", `${pageKey}.${sectionTask.sectionId}.task.json`),
        sectionTask
      );
    }

    await writeJson(
      path.join(outputDir, "agent", `page.${pageKey}.task.json`),
      buildAgentPageTask({
        pageKey,
        surfaceType: bundle.surfaceType,
        sharedSurfaceKeys: bundle.sharedSurfaceKeys,
        fidelity: bundle.fidelity,
        capturePlan,
        sectionTasks
      })
    );

    pages.push({
      pageKey,
      sectionCount: bundle.sections.length
    });
    runtimePages.push({
      pageKey,
      pageName: bundle.page.pageName,
      surfaceType: bundle.surfaceType,
      templatePath,
      captures: buildCapturePlan(pageKey, bundle).captures
    });
  }

  const runtimeOwnedPages = runtimePages.filter((page) => page.surfaceType !== "global");

  await writeJson(
    path.join(outputDir, "runtime", "runtime-profile.json"),
    buildRuntimeProfile(runtimeOwnedPages)
  );
  await writeJson(
    path.join(outputDir, "runtime", "theme-project.binding.example.json"),
    buildThemeProjectBindingExample(runtimeOwnedPages.map((page) => page.pageKey))
  );

  return {
    outputDir,
    pages
  };
}

if (isMainModule(import.meta.url)) {
  const rootDir = process.cwd();
  const result = await compileThemeStarter({ rootDir });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
