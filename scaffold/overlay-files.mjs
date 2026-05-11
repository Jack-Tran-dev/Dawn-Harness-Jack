export const HARNESS_PACKAGE_SCRIPTS = {
  "bootstrap:kik-theme": "make bootstrap-kik-theme",
  "sync:kik-tokens": "make sync-kik-tokens",
  "init:kik-theme": "make init-kik-theme",
  "inspect:project": "node ./scripts/inspect/inspect-project.mjs",
  "inspect:harness": "node ./scripts/inspect/inspect-harness.mjs",
  "inspect:runtime": "node ./scripts/inspect/inspect-runtime.mjs",
  "inspect:bootstrap": "node ./scripts/inspect/inspect-bootstrap.mjs",
  "resolve:page-key": "node ./scripts/agent/resolve-page-key.mjs",
  "assemble:page-templates": "node ./scripts/agent/assemble-page-templates.mjs",
  "create:section-preview": "node ./scripts/agent/create-section-preview.mjs",
  "assert:page-acceptance": "node ./scripts/agent/assert-page-acceptance.mjs",
  "verify:page-preview": "node ./scripts/agent/verify-page-preview.mjs",
  "verify:section-preview": "node ./scripts/agent/verify-section-preview.mjs",
  "verify:section-preview-offline": "node ./scripts/agent/verify-section-preview-offline.mjs",
  "notes:init": "node ./scripts/agent/init-section-notes.mjs",
  "storefront-dev:start": "node ./scripts/agent/storefront-dev.mjs start",
  "storefront-dev:stop": "node ./scripts/agent/storefront-dev.mjs stop",
  "storefront-dev:status": "node ./scripts/agent/storefront-dev.mjs status",
  "storefront-dev:restart": "node ./scripts/agent/storefront-dev.mjs restart",
  "verify:section-implementation": "node ./scripts/verify/verify-section-implementation.mjs",
  "prepare:page-dispatch": "node ./scripts/agent/prepare-page-dispatch.mjs",
  "run:page-dispatch": "node ./scripts/agent/run-page-dispatch.mjs",
  "build:page-verification": "node ./scripts/agent/build-page-verification.mjs",
  "figma:extract-assets": "node ./scripts/figma/extract-assets.mjs",
  "sync:runtime-captures": "node ./scripts/runtime/sync-runtime-captures.mjs",
  "verify:harness": "node ./scripts/verify/verify-harness.mjs",
  "verify:runtime": "node ./scripts/verify/verify-runtime.mjs",
  "compile:starter": "node ./harness/compiler/compile-theme-starter.mjs"
};

// Path convention:
// - Plain entries (e.g. "harness/contracts/...") are read from the same path in the
//   harness repo and written to the same path in the consumer project. They cover
//   files that are dual-use: the harness itself reads them at runtime, and consumers
//   need them at the same location after overlay sync.
// - Entries starting with "scaffold/overlay/" are pure consumer payload. The renderer
//   strips that prefix when computing the target path, so the file is read from
//   harness-repo:scaffold/overlay/X and written to consumer:X. This separation keeps
//   the harness CLI repo's own root focused on maintainer concerns; everything that
//   reads as "consumer project guidance" lives under scaffold/overlay/.
export const OVERLAY_COPY_FILES = [
  ".github/workflows/validate-page-acceptance.yml",
  ".githooks/pre-push",
  "scaffold/overlay/AGENTS.md",
  "Makefile",
  "scaffold/overlay-files.mjs",
  "scaffold/render-harness-overlay.mjs",
  "scaffold/overlay/docs/ai/README.md",
  "scaffold/overlay/docs/ai/agent-workflow.md",
  "scaffold/overlay/docs/ai/figma-asset-extraction.md",
  "scaffold/overlay/docs/ai/figma-agent-prompts.md",
  "scaffold/overlay/docs/ai/repo-map.md",
  "scaffold/overlay/docs/ai/skills.md",
  "scaffold/overlay/skills/README.md",
  "scaffold/overlay/skills/process/write-plan/SKILL.md",
  "scaffold/overlay/skills/process/verify-before-complete/SKILL.md",
  "scaffold/overlay/skills/process/tdd-loop/SKILL.md",
  "scaffold/overlay/skills/process/execute-plan/SKILL.md",
  "scaffold/overlay/skills/theme/figma-first/SKILL.md",
  "scaffold/overlay/skills/theme/swiper-carousel/SKILL.md",
  "scaffold/overlay/skills/theme/implement-figma-section/SKILL.md",
  "scaffold/overlay/skills/theme/execute-page-from-figma/SKILL.md",
  "scaffold/overlay/skills/theme/figma-classify/SKILL.md",
  "scaffold/overlay/skills/theme/initialize-page-from-figma/SKILL.md",
  "scaffold/overlay/skills/theme/implement-section-from-figma/SKILL.md",
  "scaffold/overlay/skills/theme/implement-shopify-data-section-from-figma/SKILL.md",
  "scaffold/overlay/skills/theme/verify-page-preview/SKILL.md",
  "scaffold/overlay/skills/theme/verify-section-preview/SKILL.md",
  "scaffold/overlay/skills/theme/profiles/kik/SKILL.md",
  "scaffold/overlay/skills/theme/kik-shopify-theme-init/SKILL.md",
  "scaffold/overlay/skills/theme/kik-shopify-figma-section/SKILL.md",
  "harness/contracts/agent/page-task.schema.json",
  "harness/contracts/agent/section-task.schema.json",
  "harness/contracts/agent/section-result.schema.json",
  "harness/contracts/agent/page-verification.schema.json",
  "harness/contracts/browser-verification-config.schema.json",
  "harness/contracts/agent-tools-config.schema.json",
  "harness/contracts/agent-tools-error-codes.json",
  "harness/contracts/section-notes.schema.json",
  "harness/contracts/section-runtime-deps.json",
  "harness/contracts/preview-blocker-codes.json",
  "harness/contracts/agent/section-status-decision.md",
  "harness/config/agent-tools.example.json",
  "harness/config/browser-verification.example.json",
  "harness/contracts/kik-token-source.schema.json",
  "harness/config/kik-token-source.example.json",
  "harness/contracts/figma-page-bundle.schema.json",
  "harness/contracts/figma-assets-manifest.schema.json",
  "harness/contracts/figma-source-manifest.schema.json",
  "harness/contracts/starter-review-manifest.schema.json",
  "harness/contracts/runtime-profile.schema.json",
  "harness/contracts/theme-project-binding.schema.json",
  "harness/profile-policy.mjs",
  "harness/shared/is-main-module.mjs",
  "harness/shared/load-section-notes.mjs",
  "harness/shared/resolve-page-key.mjs",
  "harness/shared/resolve-source-manifest-path.mjs",
  "harness/shared/retry-ledger.mjs",
  "harness/compiler/load-figma-bundles.mjs",
  "harness/compiler/compile-theme-starter.mjs",
  "harness/compiler/section-brief.mjs",
  "harness/runtime/build-fidelity-mask.mjs",
  "harness/runtime/compare-png-structure.mjs",
  "harness/runtime/load-runtime-profile.mjs",
  "harness/runtime/read-png-size.mjs",
  "harness/runtime/png-codec.mjs",
  "harness/runtime/load-theme-project-binding.mjs",
  "scripts/agent/assemble-page-templates.mjs",
  "scripts/agent/assert-page-acceptance.mjs",
  "scripts/agent/brief-provenance.mjs",
  "scripts/agent/build-page-verification.mjs",
  "scripts/agent/create-section-preview.mjs",
  "scripts/agent/figma-classify.mjs",
  "scripts/agent/prepare-page-dispatch.mjs",
  "scripts/agent/resolve-page-key.mjs",
  "scripts/agent/run-page-dispatch.mjs",
  "scripts/agent/section-result-validation.mjs",
  "scripts/agent/verify-page-preview.mjs",
  "scripts/agent/verify-section-preview.mjs",
  "scripts/agent/verify-section-preview-offline.mjs",
  "scripts/agent/init-section-notes.mjs",
  "scripts/agent/storefront-dev.mjs",
  "scripts/agent/section-preview-preflight.mjs",
  "scripts/inspect/inspect-project.mjs",
  "scripts/inspect/inspect-harness.mjs",
  "scripts/inspect/inspect-runtime.mjs",
  "scripts/inspect/inspect-bootstrap.mjs",
  "scripts/figma/extract-assets.mjs",
  "scripts/kik/init_theme_from_templates.py",
  "scripts/verify/verify-harness.mjs",
  "scripts/verify/verify-section-implementation.mjs",
  "scripts/verify/verify-runtime.mjs",
  "scripts/runtime/sync-runtime-captures.mjs",
  // Bootstrap-only templates (require __THEME_NAME__ / __STORE__ substitution
  // at `make bootstrap-kik-theme` time). They live under scripts/kik/ — outside
  // any Shopify theme-asset scan path — so Shopify Theme Dev never tries to
  // upload them. The bootstrap script reads them via path.dirname(__file__).
  "scripts/kik/_bootstrap-templates/README.md",
  "scripts/kik/_bootstrap-templates/package.json.tmpl",
  "scripts/kik/_bootstrap-templates/shopify.theme.toml.tmpl",
  // Static scaffold files that used to live under `templates/kik-theme-init/`
  // and were rendered into place by the Python bootstrap. They are now plain
  // overlay payload — `scaffold/overlay/<path>` writes to consumer:`<path>`.
  // Keeping them out of `templates/` prevents Shopify Theme Dev from picking
  // them up as live theme files (the previous layout produced
  // "Invalid schema" / "Template type does not support JSON templates" errors
  // during every `theme dev` session).
  "scaffold/overlay/postcss.config.mjs",
  "scaffold/overlay/tailwind.config.js",
  "scaffold/overlay/vite.config.mjs",
  "scaffold/overlay/src/kik-component.js",
  "scaffold/overlay/sections/kik-preview-placeholder.liquid",
  "scaffold/overlay/templates/index.kik-preview.json"
  // Note: harness's own tests/ directory is intentionally NOT distributed to
  // consumers. Those tests validate harness logic against fixtures that only
  // matter to harness CI; running them inside a consumer project would only
  // produce noise. The Makefile's `test:` target falls through cleanly when
  // tests/ is absent (consumer case) and runs the full suite when present
  // (harness CI case). Consumer projects should add their own tests under
  // their own paths if needed.
];

export const OVERLAY_GENERATED_FILES = {
  "CLAUDE.md": `# Claude Entrypoint

This project uses \`AGENTS.md\` as the canonical agent instruction source.

Read in order:

1. \`AGENTS.md\`
2. \`docs/ai/README.md\`
3. the repo-local \`skills/*\` files referenced by the task

Do not duplicate or reinterpret the harness rules here.
`,
  "GEMINI.md": `# Gemini Entrypoint

This project uses \`AGENTS.md\` as the canonical agent instruction source.

Read in order:

1. \`AGENTS.md\`
2. \`docs/ai/README.md\`
3. the repo-local \`skills/*\` files referenced by the task

Do not duplicate or reinterpret the harness rules here.
`,
  "agent.md": `# Agent Entrypoint

This project uses \`AGENTS.md\` as the canonical agent instruction source.

Read in order:

1. \`AGENTS.md\`
2. \`docs/ai/README.md\`
3. the repo-local \`skills/*\` files referenced by the task

Do not duplicate or reinterpret the harness rules here.
`,
  "docs/plans/.gitkeep": "",
  "design-tokens/figma.variables2css.css": "",
  "harness/notes/README.md": `# Section Notes

Per-page human annotations for section implementation. File layout:

- \`harness/notes/<page-key>.json\`

Schema: \`harness/contracts/section-notes.schema.json\`.

Bootstrap a stub from an existing source-manifest:

\`\`\`sh
make notes-init PAGE=<page-key>
\`\`\`

Section agents must read this file before implementing, mirror each
relevant \`agentPrompt\` into \`section-task.brief\`, and acknowledge it via
\`section-result.notesAcknowledged\` (path + sha256 + sectionId + verbatim
\`agentPrompt\`). \`make verify-section-implementation\` blocks sections
whose declared \`implementationPolicy.pattern\` (carousel / tabs /
accordion) is not matched by the actual section markup.
`,
  "figma/README.md": `# Figma Input Contract

Preferred source-manifest work starts from:

- \`source-manifest.json\`
- \`design-assets/manifest.json\` when Figma REST assets have been extracted

Legacy page bundles, when still needed, live under:

- \`figma/<page-key>/page.json\`
- \`figma/<page-key>/sections/*.json\`
- \`figma/<page-key>/previews/*.png\`

The harness treats these files as input contracts, not product-specific source code.
`,
  "starter/theme/.gitkeep": ""
};

// Returns the consumer-relative paths owned by the overlay. Source paths under
// scaffold/overlay/ are mapped back to the consumer's view (the prefix is stripped)
// so the metadata persisted in <consumer>/.shopify-theme-harness/scaffold.json
// reflects what the consumer actually has on disk, not where the harness keeps the
// source.
export function listOverlayOwnedFiles() {
  const OVERLAY_SOURCE_PREFIX = "scaffold/overlay/";
  const copyTargets = OVERLAY_COPY_FILES.map((sourcePath) =>
    sourcePath.startsWith(OVERLAY_SOURCE_PREFIX)
      ? sourcePath.slice(OVERLAY_SOURCE_PREFIX.length)
      : sourcePath
  );
  return [...copyTargets, ...Object.keys(OVERLAY_GENERATED_FILES)].sort((left, right) =>
    left.localeCompare(right)
  );
}
