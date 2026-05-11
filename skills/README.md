# Skills

Repo-local skills define the stable workflow for this starter.

Required process skills live under `skills/process/*`.

Theme implementation skills live under `skills/theme/*`.

Installed projects receive both:

- generic harness-owned theme workflows
- Kik-specific init and section workflows for themes that follow the Kik baseline
- a generic page-orchestration workflow plus a project profile layer under `skills/theme/profiles/*`
- a main-agent preview verification workflow that reads repo-local browser config

The preview verification workflow is Playwright CLI-only by default so browser acceptance stays scriptable and token-light.
