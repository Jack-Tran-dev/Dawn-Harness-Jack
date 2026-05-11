# Bootstrap templates

Inputs read by `scripts/kik/init_theme_from_templates.py` at `make bootstrap-kik-theme` time. They live here (under `scripts/`, outside Shopify's theme-asset scan paths) so Shopify Theme Dev does not try to upload or validate them as theme files.

These two files require runtime substitution and cannot be overlaid as static files:

- `package.json.tmpl` — `__THEME_NAME__` replaced by the resolved theme name; the bootstrap then merges the result with any pre-existing `package.json` (preserving the consumer's `name`, `version`, and unrelated scripts/devDeps while layering in the Kik scripts and dev dependencies).
- `shopify.theme.toml.tmpl` — `__STORE__` replaced by the resolved store domain; written to `shopify.theme.toml` only when the file is missing.

Static configuration files (`postcss.config.mjs`, `tailwind.config.js`, `vite.config.mjs`) and theme scaffold files (`sections/kik-preview-placeholder.liquid`, `templates/index.kik-preview.json`, `src/kik-component.js`) are no longer rendered through bootstrap; they are overlaid directly to their final paths by `npx shopify-theme-harness sync` (see `scaffold/overlay/` in the harness repo, and `scaffold/overlay-files.mjs` for the manifest).
