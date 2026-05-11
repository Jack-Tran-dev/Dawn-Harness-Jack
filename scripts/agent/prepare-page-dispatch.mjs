import fs from "node:fs/promises";
import path from "node:path";

import { isMainModule } from "../../harness/shared/is-main-module.mjs";
import { getSectionRetryStatus, readRetryLedger } from "../../harness/shared/retry-ledger.mjs";

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function buildSectionPrompt(sectionTask) {
  return [
    "Implement exactly one Shopify theme section.",
    `Surface type: ${sectionTask.surfaceType}.`,
    "Required workflow files:",
    "- skills/theme/implement-section-from-figma/SKILL.md",
    "- skills/theme/profiles/kik/SKILL.md",
    "Inputs:",
    `- section-task: agent/sections/${sectionTask.pageKey}.${sectionTask.sectionId}.task.json`,
    `- desktop bundle: ${sectionTask.inputs.desktopBundlePath}`,
    `- mobile bundle: ${sectionTask.inputs.mobileBundlePath}`,
    `- starter section: ${sectionTask.inputs.starterSectionPath}`,
    "Execution contract:",
    "- Treat the section-task JSON as the source of truth for implementationPolicy, fidelity, templateContract, and brief.",
    "- Treat section-task.templateContract as a hard assembly boundary; do not invent settings or section types outside that contract.",
    "- If section-task.dataBinding is present, implement from the native Shopify data source and report nativeShopifyDataSourceUsed in verification.checks.",
    "- Use the compiled brief as your starting restore brief before drilling into the raw bundle JSON files.",
    "- If section-task.inputs.figmaSource is present, you may use it with Figma MCP for source-node inspection while keeping the exported bundle and templateContract as the deterministic implementation contract.",
    "- Read those task fields directly and follow them exactly.",
    "- Do not use exported preview screenshots as the final implementation body for a route-owned section.",
    "- Follow workflow guidance from the referenced skills instead of inventing new protocol rules in the prompt.",
    "Return a machine-readable section-result JSON file at:",
    `- ${sectionTask.expectedResultPath}`,
    "Your section-result must include templateContribution for main-agent page assembly.",
    "Do not claim page acceptance. Return section-result fields only."
  ].join("\n");
}

export async function preparePageDispatch({
  outputDir,
  pageTaskPath
}) {
  const pageTask = await readJson(pageTaskPath);
  const { ledger: retryLedger } = await readRetryLedger({ outputDir, pageTask });
  const sections = [];

  for (const section of pageTask.sections) {
    const sectionTask = await readJson(path.join(outputDir, section.sectionTaskPath));
    const retryStatus = getSectionRetryStatus(retryLedger, pageTask, section.sectionId);
    const dispatchable = retryStatus.status !== "exhausted";
    sections.push({
      sectionId: section.sectionId,
      sectionKey: section.sectionKey,
      sectionTaskPath: section.sectionTaskPath,
      expectedResultPath: section.expectedResultPath,
      dispatchable,
      retryStatus,
      blockedReason: dispatchable
        ? null
        : `Section retry budget exhausted after ${retryStatus.attemptCount} failed attempts: ${retryStatus.lastBlockedReason}`,
      prompt: dispatchable ? buildSectionPrompt(sectionTask) : null
    });
  }

  const dispatch = {
    pageKey: pageTask.pageKey,
    profile: pageTask.profile,
    pageTaskPath: path.relative(outputDir, pageTaskPath).split(path.sep).join(path.posix.sep),
    sections
  };

  await writeJson(path.join(outputDir, pageTask.pageDispatchPath), dispatch);
  return dispatch;
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const outputDir = args[0] ? path.resolve(args[0]) : path.join(process.cwd(), "starter", "theme");
  const pageTaskPath = args[1]
    ? path.resolve(args[1])
    : path.join(outputDir, "agent", "page.home.task.json");
  const summary = await preparePageDispatch({ outputDir, pageTaskPath });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
