import fs from "node:fs/promises";
import path from "node:path";

import { inspectBootstrap } from "../inspect/inspect-bootstrap.mjs";
import { statusStorefrontDev } from "./storefront-dev.mjs";

/**
 * SectionPreviewBlocker is thrown by `preflightSectionPreview` when a stable
 * preview-blocker code from harness/contracts/preview-blocker-codes.json applies.
 * Callers (verify-section-preview, agents) should match `code` rather than parsing
 * the message; `agentFixable` distinguishes self-remediation cases from real
 * blockers.
 */
export class SectionPreviewBlocker extends Error {
  constructor({ code, agentFixable, message, remediation, detail }) {
    super(message);
    this.code = code;
    this.agentFixable = agentFixable;
    this.remediation = remediation;
    this.detail = detail ?? null;
  }
}

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

/**
 * Read tmp/storefront-dev.port if storefront-dev is the running source-of-truth.
 * Returns null when the file is missing or the port is unparseable. The caller
 * decides whether to override hardcoded URLs.
 */
export async function readDynamicStorefrontPort(rootDir) {
  const portFile = path.join(rootDir, "tmp", "storefront-dev.port");
  if (!(await pathExists(portFile))) return null;
  const txt = (await fs.readFile(portFile, "utf8")).trim();
  const parsed = Number(txt);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Replace the host:port of `url` with 127.0.0.1:<port> when port is set; pass through unchanged otherwise.
 */
export function applyDynamicPort(url, port) {
  if (!port) return url;
  try {
    const u = new URL(url);
    u.hostname = "127.0.0.1";
    u.port = String(port);
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Preflight gate for verify-section-preview. Throws SectionPreviewBlocker with a
 * stable code from harness/contracts/preview-blocker-codes.json when a prerequisite
 * is missing or the storefront dev session is not reachable. agentFixable=true
 * codes mean "the agent must remediate before delivery"; agentFixable=false codes
 * are legitimate `status: "blocked"` reasons.
 *
 * Returns { dynamicPort: number|null, storefrontStatus: object } on success so
 * the caller can override the previewUrl host:port.
 */
export async function preflightSectionPreview({ rootDir, pageKey = null }) {
  const env = await inspectBootstrap({ rootDir, pageKey });

  if (!env.bootstrapApplied.applied) {
    throw new SectionPreviewBlocker({
      code: "PREVIEW_BROWSER_CONFIG_MISSING",
      agentFixable: true,
      message: `bootstrap incomplete: missing ${env.bootstrapApplied.missing.join(", ")}`,
      remediation: "make bootstrap-kik-theme",
      detail: env.bootstrapApplied
    });
  }
  if (!env.browserConfigPresent) {
    throw new SectionPreviewBlocker({
      code: "PREVIEW_BROWSER_CONFIG_MISSING",
      agentFixable: true,
      message: "harness/config/browser-verification.json is missing",
      remediation: "make bootstrap-kik-theme",
      detail: { browserConfigPresent: false }
    });
  }
  if (!env.nodeModulesInstalled.installed) {
    throw new SectionPreviewBlocker({
      code: "PREVIEW_NODE_MODULES_MISSING",
      agentFixable: true,
      message: `node_modules not installed: ${env.nodeModulesInstalled.reason}`,
      remediation: "pnpm install --frozen-lockfile",
      detail: env.nodeModulesInstalled
    });
  }
  if (!env.buildAssetsFresh.fresh) {
    throw new SectionPreviewBlocker({
      code: "PREVIEW_BUILD_ASSETS_STALE",
      agentFixable: true,
      message: "assets/kik-theme.css or assets/kik-component.js is missing or stale",
      remediation: "pnpm build",
      detail: env.buildAssetsFresh
    });
  }
  if (env.sectionRuntimeDeps.status === "checked" && env.sectionRuntimeDeps.missing.length > 0) {
    const cmds = env.sectionRuntimeDeps.missing.map((m) => `pnpm add ${m.dep}`).join(" && ");
    throw new SectionPreviewBlocker({
      code: "PREVIEW_RUNTIME_DEP_MISSING",
      agentFixable: true,
      message: `section runtime dependency missing: ${env.sectionRuntimeDeps.missing.map((m) => m.dep).join(", ")}`,
      remediation: cmds,
      detail: env.sectionRuntimeDeps
    });
  }

  const storefrontStatus = await statusStorefrontDev({ rootDir });
  if (storefrontStatus.status === "stopped" || storefrontStatus.status === "stale-pidfile") {
    throw new SectionPreviewBlocker({
      code: "PREVIEW_STOREFRONT_NOT_RUNNING",
      agentFixable: true,
      message: `shopify theme dev is not running (storefront-dev status=${storefrontStatus.status})`,
      remediation: "node ./scripts/agent/storefront-dev.mjs start",
      detail: storefrontStatus
    });
  }
  if (storefrontStatus.status === "port-in-use-by-foreign") {
    throw new SectionPreviewBlocker({
      code: "PREVIEW_PORT_IN_USE_BY_FOREIGN_PROCESS",
      agentFixable: false,
      message: `storefront port ${storefrontStatus.port} is held by a non-shopify process`,
      remediation:
        "free the port manually, or set agent-tools.json#storefront.portFallback.strategy to 'increment'",
      detail: storefrontStatus
    });
  }
  if (storefrontStatus.status === "running-but-unreachable") {
    throw new SectionPreviewBlocker({
      code: "PREVIEW_STOREFRONT_5XX",
      agentFixable: false,
      message: `storefront-dev process is alive at pid=${storefrontStatus.pid} but http://127.0.0.1:${storefrontStatus.port}/ is unreachable: ${storefrontStatus.error}`,
      remediation: "inspect tmp/storefront-dev.log for the underlying failure",
      detail: storefrontStatus
    });
  }

  // Optional: surface agent-tools-server unreachable as informational only when this section
  // declares it needs shop context. For now we don't gate on it (verify-section-preview
  // doesn't itself call shop-context); leave as advisory.
  return {
    dynamicPort: storefrontStatus.port ?? (await readDynamicStorefrontPort(rootDir)),
    storefrontStatus,
    inspect: env
  };
}

/**
 * Convenience wrapper that maps a fetch-after-password 401 / 302 to the password-rejected
 * code. Use after the agent has attempted password submission inside the preview session.
 */
export function passwordRejectedBlocker(detail) {
  return new SectionPreviewBlocker({
    code: "PREVIEW_STOREFRONT_PASSWORD_REJECTED",
    agentFixable: false,
    message: "storefront rejected the password from agent-tools.json#storefront.password",
    remediation:
      "verify storefront.password against Online Store → Preferences → Password page; restart storefront-dev after updating",
    detail
  });
}

export const PREVIEW_BLOCKER_CODES = Object.freeze([
  "PREVIEW_BROWSER_CONFIG_MISSING",
  "PREVIEW_NODE_MODULES_MISSING",
  "PREVIEW_BUILD_ASSETS_STALE",
  "PREVIEW_RUNTIME_DEP_MISSING",
  "PREVIEW_STOREFRONT_NOT_RUNNING",
  "PREVIEW_PORT_IN_USE_BY_FOREIGN_PROCESS",
  "PREVIEW_STOREFRONT_PASSWORD_REJECTED",
  "PREVIEW_STOREFRONT_5XX",
  "PREVIEW_AGENT_TOOLS_SERVER_UNREACHABLE"
]);
