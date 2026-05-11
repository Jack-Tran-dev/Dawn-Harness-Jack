---
name: execute-plan
description: Use when executing a repo-local plan and continuing until the deterministic frontier is exhausted
---

# Execute Plan

## Goal

Carry a repo-local plan through to completion instead of stopping after one passing slice.

## Rules

- read the whole plan first
- keep plan status current
- treat stale plan notes as drift to reconcile, not as blockers
- continue while the next step is deterministic
- stop only for missing external input, material design choice, or environment blocker
