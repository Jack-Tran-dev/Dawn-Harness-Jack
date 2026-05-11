---
name: figma-classify
description: Classify a desktop/mobile Figma frame pair into static or Shopify data-bound sections for source-manifest or legacy bundle workflows.
---

# Figma Classify

## Goal

Create a committed classification document at `figma/classifications/<fileKey>__<desktopFrameId>__<mobileFrameId>.json` so the harness can carry Shopify data bindings into section tasks and agents can avoid uploading data-owned assets.

## Inputs

- desktop Figma frame URL with `node-id`
- mobile Figma frame URL with `node-id`
- `harness/config/agent-tools.json` for the target Shopify store

## Workflow

0. Resolve the active page-key by running `node ./scripts/agent/resolve-page-key.mjs --json`. The resolver reads `feat/<page-key>` from the current git branch unless `--page=<key>` / `PAGE=<key>` overrides it. Use this page-key consistently in every artifact emitted by this skill; do not infer it from filenames or prose. If the resolver errors, surface its message verbatim and stop.
1. Parse both URLs and confirm they share the same file key.
2. Inspect both frame nodes through available Figma tooling.
3. Determine desktop/mobile by frame width; reject equal widths.
4. Build the section tree fingerprint using the same shape documented in `docs/plans/2026-05-06-figma-classification-skill-design.md`.
5. Fetch live shop context from the configured agent tool server. Prefer `harness/config/agent-tools.json`; use `toolServer.routes.shopContext`; read the bearer token from the environment variable named by `toolServer.auth.tokenEnv`.
6. Classify each section as either static (`binding: null`) or one of:
   - `product`
   - `collection`
   - `article`
   - `metaobject`
7. Do not emit unresolved handles as valid bindings. Mark unresolved rows with `needsHumanReview` and `missingShopState`.
8. Ask the developer to confirm low-confidence or `needsHumanReview` rows.
9. Write a candidate JSON file, then run:

```bash
node ./scripts/agent/figma-classify.mjs \
  --desktop-url "<desktop-url>" \
  --mobile-url "<mobile-url>" \
  --shop-context-json "<shop-context-json>" \
  --classification-json "<candidate-json>"
```

10. If the output already exists, inspect the printed diff and rerun with `--overwrite` only after the developer confirms.

## Rules

- The repo file is authoritative; do not store classification documents on the sync server.
- Use canonical Figma ids in JSON fields, such as `1:3005`.
- Use URL-safe frame ids in filenames, such as `1-3005`.
- Keep reasoning concise and reviewable.
- Prefer `binding: null` over guessing when shop context does not support a binding.
