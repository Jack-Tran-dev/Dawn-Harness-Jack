# Figma Input Contract

Preferred source-manifest work starts from:

- `source-manifest.json`
- `design-assets/manifest.json` when Figma REST assets have been extracted

Legacy page bundles, when still needed, live under:

- `figma/<page-key>/page.json`
- `figma/<page-key>/sections/*.json`
- `figma/<page-key>/previews/*.png`

The harness treats these files as input contracts, not product-specific source code.
