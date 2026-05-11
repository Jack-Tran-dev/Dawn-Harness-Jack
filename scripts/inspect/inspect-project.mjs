import fs from "node:fs";

import { readHarnessOverlayStatus } from "../../scaffold/render-harness-overlay.mjs";
import { inspectHarness } from "./inspect-harness.mjs";
import { inspectRuntime } from "./inspect-runtime.mjs";
import { isMainModule } from "../../harness/shared/is-main-module.mjs";

export async function inspectProject({
  rootDir
}) {
  const projectRoot = fs.realpathSync(rootDir);
  const [overlay, harness, runtime] = await Promise.all([
    Promise.resolve(readHarnessOverlayStatus(projectRoot)),
    inspectHarness({ rootDir: projectRoot }),
    inspectRuntime({ rootDir: projectRoot })
  ]);

  return {
    projectRoot,
    overlay,
    harness,
    runtime
  };
}

if (isMainModule(import.meta.url)) {
  const summary = await inspectProject({ rootDir: process.cwd() });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}
