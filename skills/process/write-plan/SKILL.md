---
name: write-plan
description: Use when structural or multi-step work needs a repo-local executable plan
---

# Write Plan

## Goal

Turn requirements into a repo-local execution artifact that another agent can execute without hidden chat context.

## Required Header

Every plan must include:

- `# <Name> Implementation Plan`
- `**Goal:**`
- `**Architecture:**`
- `**Tech Stack:**`
- `**Execution Status:** idle` or `in_progress`
- `## Execution Contract`

## Rules

- use repo-relative paths only
- make plans the system of record for structural work
- keep tasks deterministic and small
- name exact verify commands
