import fs from "node:fs/promises";
import path from "node:path";

import { isMainModule } from "../../harness/shared/is-main-module.mjs";
import {
  getSectionResultShapeError,
  getTemplateContributionPolicyError
} from "./section-result-validation.mjs";

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function slugify(value) {
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "section";
}

function templateBaseForSurface(surfaceType) {
  if (surfaceType === "product") {
    return "product";
  }
  if (surfaceType === "cart") {
    return "cart";
  }
  return "index";
}

function defaultPreviewUrlForSurface({ surfaceType, view }) {
  if (surfaceType === "product") {
    return `http://127.0.0.1:9292/products/example-product?view=${view}`;
  }
  if (surfaceType === "cart") {
    return `http://127.0.0.1:9292/cart?view=${view}`;
  }
  return `http://127.0.0.1:9292/?view=${view}`;
}

function buildTemplateSection(result) {
  const section = {
    type: result.templateContribution.sectionType,
    settings: result.templateContribution.settings
  };

  if (result.templateContribution.blocks) {
    section.blocks = result.templateContribution.blocks;
  }
  if (result.templateContribution.block_order) {
    section.block_order = result.templateContribution.block_order;
  }
  if (result.templateContribution.disabled === true) {
    section.disabled = true;
  }

  return section;
}

function buildSectionPreviewTemplate({ sectionTask, result }) {
  return {
    sections: {
      [sectionTask.templateSectionId]: buildTemplateSection(result)
    },
    order: [sectionTask.templateSectionId]
  };
}

export function getSectionPreviewDescriptor(sectionTask) {
  const pageSlug = slugify(sectionTask.pageKey);
  const sectionSlug = slugify(sectionTask.sectionId);
  const view = `kik-section-${pageSlug}-${sectionSlug}`;
  const templateBase = templateBaseForSurface(sectionTask.surfaceType);

  return {
    view,
    routeKey:
      sectionTask.surfaceType === "product"
        ? "productPreviewUrl"
        : sectionTask.surfaceType === "cart"
          ? "cartPreviewUrl"
          : "pagePreviewUrl",
    templatePath: `templates/${templateBase}.${view}.json`,
    previewUrl: defaultPreviewUrlForSurface({
      surfaceType: sectionTask.surfaceType,
      view
    })
  };
}

export async function createSectionPreview({
  outputDir,
  sectionTaskPath,
  projectRoot = outputDir,
  resultPath
}) {
  const sectionTask = await readJson(sectionTaskPath);
  const resolvedResultPath = resultPath
    ? path.resolve(resultPath)
    : path.join(outputDir, sectionTask.expectedResultPath);
  const result = await readJson(resolvedResultPath);

  const shapeError = getSectionResultShapeError(result);
  if (shapeError) {
    throw new Error(`${sectionTask.sectionId}: ${shapeError}`);
  }
  const templateContractError = getTemplateContributionPolicyError(result, sectionTask);
  if (templateContractError) {
    throw new Error(`${sectionTask.sectionId}: ${templateContractError}`);
  }
  if (result.status !== "completed") {
    throw new Error(`${sectionTask.sectionId}: section result status is ${result.status}`);
  }

  const descriptor = getSectionPreviewDescriptor(sectionTask);
  const template = buildSectionPreviewTemplate({ sectionTask, result });
  await writeJson(path.join(projectRoot, descriptor.templatePath), template);

  const summary = {
    pageKey: sectionTask.pageKey,
    sectionId: sectionTask.sectionId,
    templateSectionId: sectionTask.templateSectionId,
    sectionType: result.templateContribution.sectionType,
    routeKey: descriptor.routeKey,
    view: descriptor.view,
    templatePath: descriptor.templatePath,
    previewUrl: descriptor.previewUrl,
    status: "created"
  };

  await writeJson(
    path.join(
      outputDir,
      "agent",
      "section-previews",
      `${sectionTask.pageKey}.${sectionTask.sectionId}.preview-template.json`
    ),
    summary
  );

  return summary;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const outputDir = args[0]
    ? path.resolve(args[0])
    : path.join(process.cwd(), "starter", "theme");
  const sectionTaskPath = args[1]
    ? path.resolve(args[1])
    : path.join(outputDir, "agent", "sections", "home.section-01.task.json");
  const projectRoot = args[2] ? path.resolve(args[2]) : process.cwd();
  const resultPath = args[3] ? path.resolve(args[3]) : undefined;
  const summary = await createSectionPreview({
    outputDir,
    sectionTaskPath,
    projectRoot,
    resultPath
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
