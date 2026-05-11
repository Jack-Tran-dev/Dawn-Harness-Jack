import fs from "node:fs/promises";
import path from "node:path";

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function loadThemeProjectBinding({
  outputDir,
  bindingPath
}) {
  const resolvedBindingPath =
    bindingPath || path.join(outputDir, "runtime", "theme-project.binding.json");

  if (!(await pathExists(resolvedBindingPath))) {
    throw new Error(`Missing theme-project binding file: ${resolvedBindingPath}`);
  }

  const binding = JSON.parse(await fs.readFile(resolvedBindingPath, "utf8"));

  return {
    bindingPath: resolvedBindingPath,
    binding
  };
}
