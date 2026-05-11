import fs from "node:fs/promises";
import path from "node:path";

import { loadRuntimeProfile } from "../../harness/runtime/load-runtime-profile.mjs";
import { loadThemeProjectBinding } from "../../harness/runtime/load-theme-project-binding.mjs";
import { isMainModule } from "../../harness/shared/is-main-module.mjs";

function flatCaptureName(pageKey, sectionId, breakpoint) {
  return `${pageKey}--${sectionId}--${breakpoint}.png`;
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function syncRuntimeCaptures({
  rootDir,
  outputDir = path.join(rootDir, "starter", "theme"),
  bindingPath
}) {
  const { runtimeProfile } = await loadRuntimeProfile({ outputDir });
  const { binding } = await loadThemeProjectBinding({ outputDir, bindingPath });

  if (binding.capturePathStyle !== "flat") {
    throw new Error(`Unsupported capturePathStyle: ${binding.capturePathStyle}`);
  }

  const selectedPages = new Set(binding.pageKeys);
  let copied = 0;
  const missing = [];

  for (const page of runtimeProfile.pages) {
    if (!selectedPages.has(page.pageKey)) {
      continue;
    }

    for (const capture of page.captures) {
      const sourceFile = path.join(
        binding.captureSourceDir,
        flatCaptureName(page.pageKey, capture.sectionId, capture.breakpoint)
      );
      const targetFile = path.join(outputDir, capture.expectedCapturePath);

      if (!(await pathExists(sourceFile))) {
        missing.push({
          pageKey: page.pageKey,
          sectionId: capture.sectionId,
          breakpoint: capture.breakpoint,
          expectedSourceFile: sourceFile
        });
        continue;
      }

      await ensureDir(path.dirname(targetFile));
      await fs.copyFile(sourceFile, targetFile);
      copied += 1;
    }
  }

  return {
    copied,
    missing
  };
}

if (isMainModule(import.meta.url)) {
  const summary = await syncRuntimeCaptures({ rootDir: process.cwd() });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
