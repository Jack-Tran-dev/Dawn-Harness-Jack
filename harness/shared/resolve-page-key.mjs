import { execFileSync } from "node:child_process";

export const PAGE_KEY_PATTERN = /^[a-z][a-z0-9-]*$/;
export const PAGE_BRANCH_PREFIX = "feat/";

const PROTECTED_BRANCHES = new Set(["main", "master", "develop", "trunk"]);
const PROTECTED_BRANCH_PREFIXES = ["release/", "hotfix/", "fix/", "chore/", "docs/", "refactor/"];

class PageKeyResolutionError extends Error {
  constructor(message, { code, details } = {}) {
    super(message);
    this.name = "PageKeyResolutionError";
    this.code = code ?? "ERR_PAGE_KEY_RESOLUTION";
    if (details) {
      this.details = details;
    }
  }
}

function validatePageKey(candidate, { sourceLabel }) {
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new PageKeyResolutionError(
      `${sourceLabel} produced an empty page-key. Expected a non-empty string matching ${PAGE_KEY_PATTERN}.`,
      { code: "ERR_PAGE_KEY_EMPTY" }
    );
  }
  if (!PAGE_KEY_PATTERN.test(candidate)) {
    throw new PageKeyResolutionError(
      `${sourceLabel} produced page-key "${candidate}", which does not match ${PAGE_KEY_PATTERN}. ` +
        `Use lowercase letters, digits, and hyphens only (e.g. "pococo-home"). ` +
        `If this came from your git branch, rename it: git branch -m ${PAGE_BRANCH_PREFIX}<page-key>.`,
      { code: "ERR_PAGE_KEY_INVALID", details: { candidate } }
    );
  }
  return candidate;
}

function readGitBranch(rootDir) {
  try {
    const stdout = execFileSync("git", ["-C", rootDir, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    return stdout.trim();
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr).trim() : "";
    throw new PageKeyResolutionError(
      `Could not read the current git branch from ${rootDir}. ` +
        `git is required to resolve the page-key from the branch name. ` +
        `Either run inside a git working tree on a feat/<page-key> branch, or pass --page=<page-key> / set PAGE=<page-key>. ` +
        `Underlying error: ${error?.message ?? "unknown"}${stderr ? ` (${stderr})` : ""}`,
      { code: "ERR_PAGE_KEY_GIT_UNAVAILABLE" }
    );
  }
}

function resolveFromBranch({ rootDir }) {
  const branch = readGitBranch(rootDir);

  if (branch === "HEAD" || branch.length === 0) {
    throw new PageKeyResolutionError(
      `Detached HEAD detected (no current branch in ${rootDir}). ` +
        `The page-key cannot be inferred without a feat/<page-key> branch. ` +
        `Pass --page=<page-key> or set PAGE=<page-key> to override.`,
      { code: "ERR_PAGE_KEY_DETACHED_HEAD" }
    );
  }

  if (PROTECTED_BRANCHES.has(branch) || PROTECTED_BRANCH_PREFIXES.some((prefix) => branch.startsWith(prefix))) {
    throw new PageKeyResolutionError(
      `Current branch is "${branch}", which is not a feat/<page-key> branch. ` +
        `Start a new page on its own branch: git checkout -b ${PAGE_BRANCH_PREFIX}<page-key>. ` +
        `For one-off CI / scripted runs you can pass --page=<page-key> or set PAGE=<page-key> to override.`,
      { code: "ERR_PAGE_KEY_PROTECTED_BRANCH", details: { branch } }
    );
  }

  if (!branch.startsWith(PAGE_BRANCH_PREFIX)) {
    throw new PageKeyResolutionError(
      `Current branch "${branch}" does not start with "${PAGE_BRANCH_PREFIX}". ` +
        `Page work must live on a feat/<page-key> branch (one page per branch). ` +
        `Rename: git branch -m ${PAGE_BRANCH_PREFIX}<page-key>, or pass --page=<page-key> to override.`,
      { code: "ERR_PAGE_KEY_NOT_FEAT_BRANCH", details: { branch } }
    );
  }

  const remainder = branch.slice(PAGE_BRANCH_PREFIX.length);
  if (remainder.length === 0) {
    throw new PageKeyResolutionError(
      `Current branch is "${branch}" but the part after "${PAGE_BRANCH_PREFIX}" is empty. ` +
        `Rename the branch: git branch -m ${PAGE_BRANCH_PREFIX}<page-key>.`,
      { code: "ERR_PAGE_KEY_EMPTY_BRANCH_SUFFIX", details: { branch } }
    );
  }
  if (remainder.includes("/")) {
    throw new PageKeyResolutionError(
      `Current branch "${branch}" contains an extra slash after "${PAGE_BRANCH_PREFIX}". ` +
        `Page-key branches must have exactly one segment after the prefix (e.g. ${PAGE_BRANCH_PREFIX}pococo-home). ` +
        `Rename: git branch -m ${PAGE_BRANCH_PREFIX}<page-key>.`,
      { code: "ERR_PAGE_KEY_NESTED_BRANCH", details: { branch } }
    );
  }

  const candidate = validatePageKey(remainder, {
    sourceLabel: `git branch "${branch}"`
  });
  return { pageKey: candidate, source: "branch", branch };
}

/**
 * Resolve the active page-key for tools that operate on a single page.
 *
 * Resolution order:
 *   1. explicit override (CLI flag --page=<key> or env PAGE=<key>)
 *   2. current git branch, expected to be feat/<page-key>
 *
 * On failure, throws a PageKeyResolutionError with an actionable message and a stable
 * code (ERR_PAGE_KEY_*).
 *
 * @param {object} options
 * @param {string} options.rootDir          repo working tree to read git from
 * @param {object} [options.env]            env source for PAGE override (defaults to process.env)
 * @param {string|null} [options.override]  explicit override (e.g. parsed --page=<key>)
 * @returns {{ pageKey: string, source: "override" | "branch", branch?: string }}
 */
export function resolvePageKey({ rootDir, env = process.env, override = null } = {}) {
  if (!rootDir || typeof rootDir !== "string") {
    throw new PageKeyResolutionError("resolvePageKey requires a string rootDir.", {
      code: "ERR_PAGE_KEY_BAD_ARGS"
    });
  }

  if (override !== null && override !== undefined && override !== "") {
    return {
      pageKey: validatePageKey(String(override), { sourceLabel: "--page override" }),
      source: "override"
    };
  }

  const envOverride = env?.PAGE;
  if (envOverride !== undefined && envOverride !== null && envOverride !== "") {
    return {
      pageKey: validatePageKey(String(envOverride), { sourceLabel: "PAGE env var" }),
      source: "override"
    };
  }

  return resolveFromBranch({ rootDir });
}

/**
 * Non-throwing variant. Returns { ok: true, pageKey, source, branch? } on success
 * or { ok: false, code, message } on failure. Useful for CLIs that want to control
 * the exit format themselves.
 */
export function tryResolvePageKey(options) {
  try {
    const result = resolvePageKey(options);
    return { ok: true, ...result };
  } catch (error) {
    if (error instanceof PageKeyResolutionError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}

export { PageKeyResolutionError };
