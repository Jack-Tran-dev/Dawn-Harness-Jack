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

export async function assemblePageTemplates({
  outputDir,
  pageTaskPath,
  projectRoot = outputDir
}) {
  const pageTask = await readJson(pageTaskPath);
  const template = {
    sections: {},
    order: []
  };

  for (const section of pageTask.sections) {
    const resultPath = path.join(outputDir, section.expectedResultPath);
    const sectionTaskPath = path.join(outputDir, section.sectionTaskPath);
    let result;
    let sectionTask;

    try {
      result = await readJson(resultPath);
    } catch (error) {
      throw new Error(`Missing section result for ${section.sectionId} at ${section.expectedResultPath}`);
    }

    const shapeError = getSectionResultShapeError(result);
    if (shapeError) {
      throw new Error(`${section.sectionId}: ${shapeError}`);
    }
    sectionTask = await readJson(sectionTaskPath);
    const templateContractError = getTemplateContributionPolicyError(result, sectionTask);
    if (templateContractError) {
      throw new Error(`${section.sectionId}: ${templateContractError}`);
    }
    if (result.status !== "completed") {
      throw new Error(`${section.sectionId}: section result status is ${result.status}`);
    }

    template.sections[section.templateSectionId] = buildTemplateSection(result);
    template.order.push(section.templateSectionId);
  }

  if (pageTask.deliveryTemplatePath) {
    await writeJson(path.join(projectRoot, pageTask.deliveryTemplatePath), template);
    await writeJson(path.join(projectRoot, pageTask.preview.template), template);
  }

  const summary = {
    pageKey: pageTask.pageKey,
    profile: pageTask.profile,
    surfaceType: pageTask.surfaceType,
    sectionCount: pageTask.sections.length,
    deliveryTemplatePath: pageTask.deliveryTemplatePath,
    previewTemplatePath: pageTask.deliveryTemplatePath ? pageTask.preview.template : null
  };

  await writeJson(path.join(outputDir, "agent", `page.${pageTask.pageKey}.assembly.json`), summary);
  return summary;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const outputDir = args[0] ? path.resolve(args[0]) : path.join(process.cwd(), "starter", "theme");
  const pageTaskPath = args[1]
    ? path.resolve(args[1])
    : path.join(outputDir, "agent", "page.home.task.json");
  const projectRoot = args[2] ? path.resolve(args[2]) : process.cwd();
  const summary = await assemblePageTemplates({ outputDir, pageTaskPath, projectRoot });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
