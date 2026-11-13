---
status: pending
priority: p2
issue_id: "001"
tags: [code-review, security, ci]
dependencies: []
---

# Pin GitHub Actions to commit SHAs and isolate the release token

## Problem Statement

.github/workflows/build.yml uses movable refs (dtolnay/rust-toolchain@stable, swatinem/rust-cache@v2, tauri-apps/tauri-action@v0, actions/*@v4) in a job that holds contents: write. If any of them is hijacked, a backdoored installer ships to the public. persist-credentials: false is already set on checkout.

## Proposed Solutions

1. Pin every action to a full commit SHA (look each one up on GitHub; they could not be verified offline). Small effort, low risk.
2. Additionally build in a job with contents: read and upload the release from a separate small job that holds contents: write. Medium effort.
3. Pin the Node version instead of lts/*. Small effort.

## Recommended Action

_To be filled in during triage._

## Acceptance Criteria

- [ ] Every uses: line references a 40-character SHA
- [ ] Build job has read-only permissions
- [ ] A tagged run still produces all three installers

## Work Log

- 2026-11-13: Found in code review of the initial working tree. Not started.
