# Section Notes

Per-page human annotations for section implementation. File layout:

- `harness/notes/<page-key>.json`

Schema: `harness/contracts/section-notes.schema.json`.

Bootstrap a stub from an existing source-manifest:

```sh
make notes-init PAGE=<page-key>
```

Section agents must read this file before implementing, mirror each
relevant `agentPrompt` into `section-task.brief`, and acknowledge it via
`section-result.notesAcknowledged` (path + sha256 + sectionId + verbatim
`agentPrompt`). `make verify-section-implementation` blocks sections
whose declared `implementationPolicy.pattern` (carousel / tabs /
accordion) is not matched by the actual section markup.
