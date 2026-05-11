import { loadSectionNotes } from "../../harness/shared/load-section-notes.mjs";

// harness/profile-policy.mjs is part of the harness overlay. We load it here so that callers
// that don't need the profile policy (create-section-preview, assemble-page-templates) can still
// be imported in projects whose overlay is incomplete. Only getSectionResultPolicyError surfaces
// the missing-module condition, with an actionable message instead of Node's ERR_MODULE_NOT_FOUND.
let profilePolicyModule = null;
let profilePolicyLoadError = null;
try {
  profilePolicyModule = await import("../../harness/profile-policy.mjs");
} catch (error) {
  profilePolicyLoadError = error;
}

const INTERACTION_IMPLEMENTATION_MODES = new Set(["swiper", "scroll-snap", "custom"]);

function requireProfilePolicyModule() {
  if (profilePolicyModule) {
    return profilePolicyModule;
  }
  const baseMessage =
    profilePolicyLoadError?.code === "ERR_MODULE_NOT_FOUND"
      ? "harness/profile-policy.mjs is missing from this project's overlay."
      : `harness/profile-policy.mjs failed to load: ${profilePolicyLoadError?.message ?? "unknown error"}`;
  const remediation =
    "Re-run `npx shopify-theme-harness sync` (or upgrade shopify-theme-harness to a release that ships harness/profile-policy.mjs) to restore the file.";
  const err = new Error(`${baseMessage} ${remediation}`);
  err.code = "ERR_HARNESS_PROFILE_POLICY_MISSING";
  throw err;
}

const REQUIRED_SECTION_RESULT_FIELDS = [
  "sectionId",
  "status",
  "changedFiles",
  "summary",
  "verification",
  "templateContribution",
  "implementationDecision",
  "commandsRun",
  "openIssues",
  "needsMainAgentVerification"
];

const REQUIRED_SECTION_VERIFICATION_FIELDS = [
  "status",
  "summary",
  "checks"
];

function hasCheck(result, token) {
  return result.verification?.checks?.[token] === true;
}

function getRequiredCheckError(result, requiredCheck) {
  if (!hasCheck(result, requiredCheck)) {
    return `section result did not satisfy required check ${requiredCheck}`;
  }

  return null;
}

export function getSectionResultShapeError(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return "section result payload must be an object";
  }

  for (const field of REQUIRED_SECTION_RESULT_FIELDS) {
    if (!(field in result)) {
      return `section result is missing required field: ${field}`;
    }
  }

  if (
    !result.verification ||
    typeof result.verification !== "object" ||
    Array.isArray(result.verification)
  ) {
    return "section result verification payload must be an object";
  }

  for (const field of REQUIRED_SECTION_VERIFICATION_FIELDS) {
    if (!(field in result.verification)) {
      return `section result verification payload is missing required field: ${field}`;
    }
  }

  if (
    !result.verification.checks ||
    typeof result.verification.checks !== "object" ||
    Array.isArray(result.verification.checks)
  ) {
    return "section result verification checks payload must be an object";
  }

  const contribution = result.templateContribution;
  if (!contribution || typeof contribution !== "object" || Array.isArray(contribution)) {
    return "templateContribution must be an object";
  }
  if (typeof contribution.sectionType !== "string" || contribution.sectionType.length === 0) {
    return "templateContribution.sectionType must be a non-empty string";
  }
  if (!contribution.settings || typeof contribution.settings !== "object" || Array.isArray(contribution.settings)) {
    return "templateContribution.settings must be an object";
  }

  return null;
}

export function getTemplateContributionPolicyError(result, sectionTask) {
  const contract = sectionTask?.templateContract;
  if (!contract) {
    return null;
  }

  const contribution = result.templateContribution;
  if (contribution.sectionType !== contract.sectionType) {
    return `section result section type ${contribution.sectionType} does not match compiled section type ${contract.sectionType}`;
  }

  const allowedSettingIds = Array.isArray(contract.allowedSettingIds) ? contract.allowedSettingIds : [];
  for (const settingId of Object.keys(contribution.settings ?? {})) {
    if (!allowedSettingIds.includes(settingId)) {
      return `templateContribution has unexpected setting key: ${settingId}`;
    }
  }

  const hasBlocks =
    (contribution.blocks && Object.keys(contribution.blocks).length > 0) ||
    (Array.isArray(contribution.block_order) && contribution.block_order.length > 0);
  if (contract.blockPolicy === "forbidden" && hasBlocks) {
    return "templateContribution blocks are not allowed by the compiled template contract";
  }

  return null;
}

function getSectionPreviewModeError(result) {
  const sectionPreview = result?.sectionPreview;
  if (!sectionPreview) {
    return null;
  }
  const mode = sectionPreview.mode ?? null;
  if (mode === "offline-snapshot" && result.status === "completed") {
    return "section result with sectionPreview.mode=offline-snapshot must declare status=partial; offline snapshots are triage evidence only and cannot be the acceptance proof. Re-run make verify-section-preview against the storefront before claiming completed.";
  }
  if (result.status === "completed" && mode && mode !== "storefront-render") {
    return `section result status=completed requires sectionPreview.mode=storefront-render; got mode=${mode}.`;
  }
  return null;
}

async function getSectionNotesPolicyError({ result, sectionTask, rootDir }) {
  if (!rootDir) {
    return null;
  }
  const pageKey = sectionTask?.pageKey;
  if (!pageKey) {
    return null;
  }

  const loaded = await loadSectionNotes({ rootDir, pageKey });
  if (loaded.loadError) {
    return `harness/notes/${pageKey}.json could not be parsed: ${loaded.loadError.message}`;
  }
  if (!loaded.present) {
    // No notes file at all — agents should declare that explicitly via openIssues, but absence
    // is allowed (notes are optional human input). The verify-before-complete skill enforces
    // the openIssues note separately if needed.
    return null;
  }

  const sectionNotes = loaded.lookupBySectionId(result.sectionId);
  if (!sectionNotes) {
    return null;
  }

  const ack = result.notesAcknowledged;
  if (!ack || typeof ack !== "object" || Array.isArray(ack)) {
    return `section result must include notesAcknowledged because harness/notes/${pageKey}.json declares an entry for section ${result.sectionId}.`;
  }
  if (ack.path !== loaded.path) {
    return `section result notesAcknowledged.path is ${ack.path}; expected ${loaded.path}.`;
  }
  if (ack.sectionId !== result.sectionId) {
    return `section result notesAcknowledged.sectionId is ${ack.sectionId}; expected ${result.sectionId}.`;
  }
  if (ack.sha256 !== loaded.sha256) {
    return `section result notesAcknowledged.sha256 does not match the on-disk ${loaded.path}; the notes file changed since the agent read it. Re-read the notes file and update the section result.`;
  }
  if (sectionNotes.agentPrompt) {
    if (typeof ack.agentPrompt !== "string" || ack.agentPrompt !== sectionNotes.agentPrompt) {
      return `section result notesAcknowledged.agentPrompt must be a verbatim copy of the agentPrompt declared at ${loaded.path}#/sections (id=${result.sectionId}).`;
    }
  }

  const declaredPattern = sectionNotes.implementationPolicy?.pattern;
  if (declaredPattern && declaredPattern !== "static") {
    const implMode = result.implementationDecision?.mode;
    if (!INTERACTION_IMPLEMENTATION_MODES.has(implMode)) {
      return `harness/notes/${pageKey}.json declares implementationPolicy.pattern=${declaredPattern} for section ${result.sectionId}; section result implementationDecision.mode must be one of [${[...INTERACTION_IMPLEMENTATION_MODES].join(", ")}], got ${implMode}.`;
    }
  }

  return null;
}

export function getSectionResultPolicyError(result, sectionTask) {
  const templateContractError = getTemplateContributionPolicyError(result, sectionTask);
  if (templateContractError) {
    return templateContractError;
  }

  const sectionPreviewModeError = getSectionPreviewModeError(result);
  if (sectionPreviewModeError) {
    return sectionPreviewModeError;
  }

  const { getProfilePolicy, getSectionVerificationChecks } = requireProfilePolicyModule();
  const profilePolicy = getProfilePolicy(sectionTask?.profile);

  if (profilePolicy.primaryStyleStrategy === "tailwind-utilities-primary") {
    if (result.implementationDecision?.styleStrategy !== "tailwind-utilities-primary") {
      return "section result must declare Tailwind utility-first markup as the primary style strategy";
    }

    if (!hasCheck(result, "utilityMarkupUsed")) {
      return "section result must confirm utility-first markup was used in Liquid";
    }

    if (!hasCheck(result, "sharedCssPolicyRespected")) {
      return "section result must confirm the shared CSS policy was respected";
    }
  }

  const sharedStyleEntry = profilePolicy.sharedStyleEntry;
  const changedFiles = Array.isArray(result.changedFiles) ? result.changedFiles : [];
  if (sharedStyleEntry && changedFiles.includes(sharedStyleEntry)) {
    if (result.implementationDecision?.sharedStyleChange !== "shared-exception") {
      return `section result changed ${sharedStyleEntry} without declaring an explicit shared-style exception`;
    }
    if (!result.implementationDecision?.sharedStyleExceptionReason) {
      return `section result changed ${sharedStyleEntry} without a shared-style exception reason`;
    }
  }

  for (const requiredCheck of getSectionVerificationChecks(sectionTask)) {
    const checkError = getRequiredCheckError(result, requiredCheck);
    if (checkError) {
      return checkError;
    }
  }

  return null;
}

/**
 * Same gates as getSectionResultPolicyError, plus the section-notes acknowledgement gate.
 * Async because it has to read harness/notes/<pageKey>.json. Use this from any caller that
 * has access to the project rootDir; fall back to the sync variant when notes lookup is
 * intentionally skipped (e.g. fixture tests).
 */
export async function getSectionResultPolicyErrorWithNotes(result, sectionTask, { rootDir } = {}) {
  const baseError = getSectionResultPolicyError(result, sectionTask);
  if (baseError) {
    return baseError;
  }
  const notesError = await getSectionNotesPolicyError({ result, sectionTask, rootDir });
  if (notesError) {
    return notesError;
  }
  return null;
}

// Test-only helper to inspect whether the harness profile-policy module loaded successfully.
export function getProfilePolicyLoadStatus() {
  if (profilePolicyModule) {
    return { loaded: true };
  }
  return { loaded: false, error: profilePolicyLoadError };
}
