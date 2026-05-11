# Section-Result Status Decision Tree

This document is the canonical decision tree for the `status` field of
`harness/contracts/agent/section-result.schema.json`. It exists because in
practice agents have been collapsing `blocked` into a catch-all whenever any
prerequisite was missing. The schema itself only enumerates the three values
(`completed | partial | blocked`); this file is what disambiguates them.

The implementing agent must apply the predicates in order. The first matching
clause wins; later clauses are not evaluated.

## Predicates

```
status = completed
  iff   sectionPreview.mode == "storefront-render"
   AND  sectionPreview.status in {"passed", "pending-human-review"}
   AND  verification.status   != "failed"
   AND  notesAcknowledged.sha256 matches harness/notes/<page-key>.json on disk at this moment
   AND  every openIssue with `code` set refers to a code whose
        agentFixable == false in harness/contracts/preview-blocker-codes.json

status = partial
  iff   sectionPreview.mode == "offline-snapshot"
   AND  openIssues contains exactly one entry whose code is one of
        { PREVIEW_STOREFRONT_NOT_RUNNING,
          PREVIEW_STOREFRONT_PASSWORD_REJECTED,
          PREVIEW_STOREFRONT_5XX,
          PREVIEW_PORT_IN_USE_BY_FOREIGN_PROCESS }
   AND  no openIssue carries an agentFixable == true code

status = blocked
  iff   none of the above
   AND  every openIssue with `code` refers to a code whose agentFixable == false
   AND  the section was not fully implemented OR the storefront-render path is unreachable
        for a reason in the agentFixable == false set
```

If none of the three matches, the section result is **invalid** — fix the
result before returning it. The most common reason "none matches" is the agent
left an `agentFixable: true` openIssue (e.g. `PREVIEW_BUILD_ASSETS_STALE`,
`PREVIEW_NODE_MODULES_MISSING`) that it should have fixed itself before
delivery.

## Codes the agent must self-remediate (NEVER blocked)

From `harness/contracts/preview-blocker-codes.json`, every code with
`agentFixable: true`. As of v1.0.0:

- `PREVIEW_BROWSER_CONFIG_MISSING` → `make bootstrap-kik-theme`
- `PREVIEW_NODE_MODULES_MISSING` → `pnpm install --frozen-lockfile`
- `PREVIEW_BUILD_ASSETS_STALE` → `pnpm build`
- `PREVIEW_RUNTIME_DEP_MISSING` → `pnpm add <dep>` per
  `harness/contracts/section-runtime-deps.json`
- `PREVIEW_STOREFRONT_NOT_RUNNING` → `node ./scripts/agent/storefront-dev.mjs start`

If any of these codes shows up in `inspect-bootstrap` output, the agent must
run the remediation command and re-run inspect-bootstrap. Returning a section
result with one of these in `openIssues` is a contract violation.

## Codes that are legitimate `blocked` reasons

- `PREVIEW_PORT_IN_USE_BY_FOREIGN_PROCESS` (non-Shopify process holds the port
  and `portFallback.strategy: kill-shopify-only`)
- `PREVIEW_STOREFRONT_PASSWORD_REJECTED` (storefront password in
  `agent-tools.json#storefront.password` does not match the storefront's
  current password)
- `PREVIEW_STOREFRONT_5XX` (storefront returned 5xx for the section route —
  usually a Liquid syntax error or theme-check failure that needs human
  triage)
- `PREVIEW_AGENT_TOOLS_SERVER_UNREACHABLE` (only when the section actually
  needed shop context or image upload)

## Why this is split out from the schema

Schema descriptions are not a good place for multi-clause conditional logic;
JSON Schema readers (AJV, IDE tooling) skim them. Putting the decision tree
in a sibling Markdown document keeps the schema concise while making the
behavioural contract reviewable in PRs. Implementations that need to apply
this tree should reference it by path (e.g.
`harness/contracts/agent/section-status-decision.md`) so future revisions
land in one place.
