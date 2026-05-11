import path from "node:path";

import { isMainModule } from "../../harness/shared/is-main-module.mjs";
import { resolvePageKey } from "../../harness/shared/resolve-page-key.mjs";

function parseArgs(argv) {
  let rootDir = process.cwd();
  let override = null;
  let format = "text";
  let quiet = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--root") {
      rootDir = path.resolve(argv[++i]);
    } else if (arg.startsWith("--root=")) {
      rootDir = path.resolve(arg.slice("--root=".length));
    } else if (arg === "--page") {
      override = argv[++i] ?? null;
    } else if (arg.startsWith("--page=")) {
      override = arg.slice("--page=".length);
    } else if (arg === "--json") {
      format = "json";
    } else if (arg === "--quiet") {
      quiet = true;
    } else if (!arg.startsWith("--") && override === null) {
      override = arg;
    }
  }
  return { rootDir, override, format, quiet };
}

if (isMainModule(import.meta.url)) {
  const { rootDir, override, format, quiet } = parseArgs(process.argv.slice(2));
  try {
    const resolved = resolvePageKey({ rootDir, override });
    if (format === "json") {
      process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
    } else if (quiet) {
      process.stdout.write(`${resolved.pageKey}\n`);
    } else {
      const sourceLabel =
        resolved.source === "override"
          ? "override"
          : `git branch ${resolved.branch}`;
      process.stdout.write(`${resolved.pageKey}\n`);
      process.stderr.write(`resolved page-key from ${sourceLabel}\n`);
    }
  } catch (error) {
    if (format === "json") {
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: false,
            code: error?.code ?? "ERR_PAGE_KEY_RESOLUTION",
            message: error?.message ?? String(error)
          },
          null,
          2
        )}\n`
      );
    } else {
      process.stderr.write(`${error?.message ?? error}\n`);
    }
    process.exit(1);
  }
}
