import fs from "node:fs/promises";
import path from "node:path";

export async function loadRuntimeProfile({
  outputDir
}) {
  const runtimeProfilePath = path.join(outputDir, "runtime", "runtime-profile.json");
  const runtimeProfile = JSON.parse(await fs.readFile(runtimeProfilePath, "utf8"));
  return {
    runtimeProfilePath,
    runtimeProfile
  };
}
