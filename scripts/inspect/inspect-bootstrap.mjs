import fs from "node:fs/promises";
import path from "node:path";

import { isMainModule } from "../../harness/shared/is-main-module.mjs";
import { resolvePageKey } from "../../harness/shared/resolve-page-key.mjs";

const PROBE_TIMEOUT_MS = 1500;

async function pathExists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readJsonOrNull(p) {
  try {
    return JSON.parse(await fs.readFile(p, "utf8"));
  } catch {
    return null;
  }
}

async function statOrNull(p) {
  try {
    return await fs.stat(p);
  } catch {
    return null;
  }
}

async function probeHttp(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", signal: controller.signal, redirect: "manual" });
    return { ok: true, status: res.status };
  } catch (error) {
    return { ok: false, error: error.code ?? error.name ?? "fetch-failed" };
  } finally {
    clearTimeout(timer);
  }
}

async function probeBearer(url, tokenEnv) {
  const token = process.env[tokenEnv];
  if (!token) return { ok: false, error: "token-env-empty", tokenEnv };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
      redirect: "manual"
    });
    return { ok: res.ok || res.status === 401, status: res.status };
  } catch (error) {
    return { ok: false, error: error.code ?? error.name ?? "fetch-failed" };
  } finally {
    clearTimeout(timer);
  }
}

async function inspectBootstrapApplied(rootDir) {
  const required = [
    "package.json",
    "vite.config.mjs",
    "tailwind.config.js",
    "postcss.config.mjs",
    "harness/config/browser-verification.json",
    "src/input.css",
    "src/kik-component.js",
    "templates/index.kik-preview.json"
  ];
  const missing = [];
  for (const rel of required) {
    if (!(await pathExists(path.join(rootDir, rel)))) missing.push(rel);
  }

  let buildScriptPresent = false;
  const pkg = await readJsonOrNull(path.join(rootDir, "package.json"));
  if (pkg) buildScriptPresent = Boolean(pkg.scripts?.build);
  if (!buildScriptPresent) missing.push("package.json#scripts.build");

  let layoutWired = false;
  const layout = await fs.readFile(path.join(rootDir, "layout/theme.liquid"), "utf8").catch(() => "");
  if (layout.includes("kik-theme.css") && layout.includes("kik-component.js")) layoutWired = true;
  if (!layoutWired) missing.push("layout/theme.liquid#kik-theme.css/kik-component.js");

  return {
    applied: missing.length === 0,
    missing
  };
}

async function inspectNodeModules(rootDir) {
  const modulesDir = path.join(rootDir, "node_modules");
  if (!(await pathExists(modulesDir))) {
    return { installed: false, reason: "node_modules-missing" };
  }
  const modulesYaml = path.join(modulesDir, ".modules.yaml");
  if (!(await pathExists(modulesYaml))) {
    return { installed: false, reason: "no-pnpm-modules-yaml" };
  }
  return { installed: true };
}

async function inspectBuildAssetsFresh(rootDir) {
  const pairs = [
    { src: "src/input.css", out: "assets/kik-theme.css" },
    { src: "src/kik-component.js", out: "assets/kik-component.js" }
  ];
  const detail = {};
  let allFresh = true;
  for (const { src, out } of pairs) {
    const srcStat = await statOrNull(path.join(rootDir, src));
    const outStat = await statOrNull(path.join(rootDir, out));
    if (!outStat) {
      detail[out] = { exists: false, fresh: false, reason: "asset-missing" };
      allFresh = false;
      continue;
    }
    if (!srcStat) {
      detail[out] = { exists: true, fresh: false, reason: "source-missing" };
      allFresh = false;
      continue;
    }
    const fresh = outStat.mtimeMs >= srcStat.mtimeMs;
    detail[out] = { exists: true, fresh, srcMtime: srcStat.mtimeMs, outMtime: outStat.mtimeMs };
    if (!fresh) allFresh = false;
  }
  return { fresh: allFresh, detail };
}

async function inspectSectionRuntimeDeps(rootDir, pageKey, runtimeDepsContract) {
  if (!pageKey) {
    return { status: "page-key-unresolved", pageKey: null, missing: [] };
  }
  const manifestPath = path.join(rootDir, "figma", pageKey, "source-manifest.json");
  const manifest = await readJsonOrNull(manifestPath);
  if (!manifest) {
    return { status: "manifest-missing", pageKey, manifestPath: `figma/${pageKey}/source-manifest.json`, missing: [] };
  }

  const required = new Map();
  for (const section of manifest.sections ?? []) {
    const skill = section.skillRouting?.recommendedSkill ?? "";
    let pattern = "static";
    let impl = "none";
    if (skill.includes("swiper")) {
      pattern = "carousel";
      impl = "swiper";
    } else if (skill.includes("scroll-snap")) {
      pattern = "carousel";
      impl = "scroll-snap";
    }
    const matrixKey = `${pattern}/${impl}`;
    const entry = runtimeDepsContract.matrix?.[matrixKey];
    if (!entry) continue;
    for (const dep of entry.deps ?? []) {
      const name = dep.split("@")[0];
      if (!required.has(name)) required.set(name, { dep, matrixKey, sections: [] });
      required.get(name).sections.push(section.id);
    }
  }

  const missing = [];
  for (const [name, info] of required.entries()) {
    const installed = await pathExists(path.join(rootDir, "node_modules", name, "package.json"));
    if (!installed) missing.push({ name, dep: info.dep, matrixKey: info.matrixKey, sections: info.sections });
  }

  return { status: "checked", pageKey, missing };
}

async function inspectStorefront(rootDir, agentToolsConfig) {
  const portFile = path.join(rootDir, "tmp/storefront-dev.port");
  let port = null;
  let portSource = null;
  if (await pathExists(portFile)) {
    const txt = (await fs.readFile(portFile, "utf8")).trim();
    const parsed = Number(txt);
    if (Number.isFinite(parsed)) {
      port = parsed;
      portSource = "tmp/storefront-dev.port";
    }
  }
  const devUrl = agentToolsConfig?.storefront?.devUrl ?? null;
  if (port == null && devUrl) {
    try {
      port = Number(new URL(devUrl).port) || 9292;
      portSource = "agent-tools.json#storefront.devUrl";
    } catch {
      // ignore
    }
  }
  if (port == null) {
    port = 9292;
    portSource = "default";
  }
  const url = `http://127.0.0.1:${port}/`;
  const probe = await probeHttp(url);
  return {
    reachable: probe.ok,
    url,
    port,
    portSource,
    httpStatus: probe.status ?? null,
    error: probe.error ?? null
  };
}

async function inspectAgentToolsServer(agentToolsConfig) {
  if (!agentToolsConfig) return { reachable: null, reason: "agent-tools-config-missing" };
  const baseUrl = agentToolsConfig.toolServer?.baseUrl;
  const tokenEnv = agentToolsConfig.toolServer?.auth?.tokenEnv;
  const shopContextPath = agentToolsConfig.toolServer?.routes?.shopContext?.path;
  if (!baseUrl || !tokenEnv || !shopContextPath) {
    return { reachable: null, reason: "config-incomplete" };
  }
  const url = `${baseUrl.replace(/\/+$/, "")}${shopContextPath}`;
  const probe = await probeBearer(url, tokenEnv);
  return {
    reachable: probe.ok,
    url,
    httpStatus: probe.status ?? null,
    error: probe.error ?? null
  };
}

function buildRemediationCommands(report) {
  const cmds = [];
  if (!report.bootstrapApplied.applied) cmds.push("make bootstrap-kik-theme");
  if (!report.nodeModulesInstalled.installed) cmds.push("pnpm install --frozen-lockfile");
  for (const m of report.sectionRuntimeDeps.missing ?? []) cmds.push(`pnpm add ${m.dep}`);
  if (!report.buildAssetsFresh.fresh) cmds.push("pnpm build");
  if (!report.themeDevReachable.reachable) cmds.push("node ./scripts/agent/storefront-dev.mjs start");
  return cmds;
}

export async function inspectBootstrap({ rootDir, pageKey: pageKeyInput = null } = {}) {
  rootDir = rootDir ?? process.cwd();

  let pageKey = pageKeyInput;
  if (!pageKey) {
    try {
      const resolved = await resolvePageKey({ rootDir, override: null });
      pageKey = resolved?.pageKey ?? null;
    } catch {
      pageKey = null;
    }
  }

  const [agentToolsConfig, runtimeDepsContract] = await Promise.all([
    readJsonOrNull(path.join(rootDir, "harness/config/agent-tools.json")),
    readJsonOrNull(path.join(rootDir, "harness/contracts/section-runtime-deps.json")) ??
      readJsonOrNull(
        path.join(
          rootDir,
          "node_modules/shopify-theme-harness/harness/contracts/section-runtime-deps.json"
        )
      )
  ]);

  const [bootstrapApplied, nodeModulesInstalled, buildAssetsFresh] = await Promise.all([
    inspectBootstrapApplied(rootDir),
    inspectNodeModules(rootDir),
    inspectBuildAssetsFresh(rootDir)
  ]);

  const sectionRuntimeDeps = runtimeDepsContract
    ? await inspectSectionRuntimeDeps(rootDir, pageKey, runtimeDepsContract)
    : { status: "contract-missing", pageKey, missing: [] };

  const [themeDevReachable, agentToolsServerReachable] = await Promise.all([
    inspectStorefront(rootDir, agentToolsConfig),
    inspectAgentToolsServer(agentToolsConfig)
  ]);

  const browserConfigPresent = await pathExists(
    path.join(rootDir, "harness/config/browser-verification.json")
  );

  const report = {
    rootDir,
    pageKey,
    bootstrapApplied,
    nodeModulesInstalled,
    buildAssetsFresh,
    sectionRuntimeDeps,
    browserConfigPresent,
    themeDevReachable,
    agentToolsServerReachable
  };

  const ready =
    bootstrapApplied.applied &&
    nodeModulesInstalled.installed &&
    buildAssetsFresh.fresh &&
    (sectionRuntimeDeps.status !== "checked" || sectionRuntimeDeps.missing.length === 0) &&
    browserConfigPresent &&
    themeDevReachable.reachable;

  report.ready = ready;
  report.remediationCommands = buildRemediationCommands(report);

  return report;
}

function parseArgs(argv) {
  let rootDir = process.cwd();
  let pageKey = null;
  let format = "json";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root" && argv[i + 1]) {
      rootDir = path.resolve(argv[++i]);
    } else if (arg.startsWith("--root=")) {
      rootDir = path.resolve(arg.slice("--root=".length));
    } else if (arg === "--page" && argv[i + 1]) {
      pageKey = argv[++i];
    } else if (arg.startsWith("--page=")) {
      pageKey = arg.slice("--page=".length);
    } else if (arg === "--json") {
      format = "json";
    } else if (arg === "--text") {
      format = "text";
    }
  }
  return { rootDir, pageKey, format };
}

function formatText(report) {
  const lines = [];
  const mark = (ok) => (ok ? "OK " : "MISS");
  lines.push(`inspect-bootstrap (rootDir=${report.rootDir}, pageKey=${report.pageKey ?? "?"})`);
  lines.push(`  ${mark(report.bootstrapApplied.applied)} bootstrap-applied${report.bootstrapApplied.applied ? "" : ` — missing: ${report.bootstrapApplied.missing.join(", ")}`}`);
  lines.push(`  ${mark(report.nodeModulesInstalled.installed)} node_modules`);
  lines.push(`  ${mark(report.buildAssetsFresh.fresh)} build-assets-fresh`);
  if (report.sectionRuntimeDeps.status === "checked") {
    const ok = report.sectionRuntimeDeps.missing.length === 0;
    lines.push(`  ${mark(ok)} section-runtime-deps${ok ? "" : ` — missing: ${report.sectionRuntimeDeps.missing.map((m) => m.dep).join(", ")}`}`);
  } else {
    lines.push(`  --   section-runtime-deps (${report.sectionRuntimeDeps.status})`);
  }
  lines.push(`  ${mark(report.browserConfigPresent)} browser-verification.json`);
  lines.push(`  ${mark(report.themeDevReachable.reachable)} theme-dev (${report.themeDevReachable.url})`);
  if (report.agentToolsServerReachable.reachable === null) {
    lines.push(`  --   agent-tools-server (${report.agentToolsServerReachable.reason})`);
  } else {
    lines.push(`  ${mark(report.agentToolsServerReachable.reachable)} agent-tools-server (${report.agentToolsServerReachable.url})`);
  }
  if (report.remediationCommands.length > 0) {
    lines.push("");
    lines.push("Remediation:");
    for (const cmd of report.remediationCommands) lines.push(`  $ ${cmd}`);
  }
  lines.push("");
  lines.push(`ready=${report.ready}`);
  return lines.join("\n");
}

if (isMainModule(import.meta.url)) {
  const { rootDir, pageKey, format } = parseArgs(process.argv.slice(2));
  const report = await inspectBootstrap({ rootDir, pageKey });
  if (format === "text") {
    process.stdout.write(`${formatText(report)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
  process.exit(report.ready ? 0 : 1);
}
