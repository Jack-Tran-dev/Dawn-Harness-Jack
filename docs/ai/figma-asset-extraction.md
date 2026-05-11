# Figma Asset Extraction

Figma asset extraction is a developer-operated setup step, not an agent-operated task.

Agents should consume `design-assets/manifest.json` when it exists. They should not run the extractor, ask for a Figma access token, or write Figma credentials into repo files. If a section needs static imagery and the asset manifest is missing or incomplete, the agent should report the exact missing artifact and ask the developer to run the extraction step.

## When To Run

Run this after `figma/<page-key>/source-manifest.json` exists and before assigning section work that needs static images or icons.

## Configuration

Set a Figma personal access token in your shell:

```bash
export FIGMA_ACCESS_TOKEN="<figma-personal-access-token>"
```

The token is read only by the local extraction command. Do not commit it and do not put it in `harness/config/agent-tools.json`.

## Command

From the installed theme project root, on a `feat/<page-key>` branch (or with `PAGE=<page-key>` set):

```bash
make figma-extract-assets PAGE=<page-key>
```

The script resolves the manifest at `figma/<page-key>/source-manifest.json` automatically. When `PAGE` is omitted, the underlying script reads `<page-key>` from the active git branch.

Optional overrides:

```bash
make figma-extract-assets \
  PAGE=<page-key> \
  DESIGN_ASSETS_DIR=design-assets \
  FIGMA_FILE_KEY="<figma-file-key>" \
  FIGMA_TOKEN_ENV=FIGMA_ACCESS_TOKEN \
  FIGMA_API_BASE=https://api.figma.com
```

Use `FIGMA_FILE_KEY` only when `figma/<page-key>/source-manifest.json` does not contain Figma file keys.

## Output

The command writes:

- `design-assets/manifest.json`
- `design-assets/images/*`

The manifest follows `harness/contracts/figma-assets-manifest.schema.json`. Agents may use its `assetId`, `path`, `sourceSectionId`, and `sourceBreakpoint` fields to choose local static assets, then upload only the assets that are not owned by native Shopify product, collection, article, or metaobject data.

## Agent Boundary

Agents may:

- read `design-assets/manifest.json`
- validate it against `harness/contracts/figma-assets-manifest.schema.json`
- use local asset paths as static candidates
- upload vetted static assets through the configured Shopify tool server

Agents must not:

- run `make figma-extract-assets`
- request or read `FIGMA_ACCESS_TOKEN`
- call Figma REST asset download endpoints directly
- invent placeholder images when the required asset is missing
