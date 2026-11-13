---
status: pending
priority: p3
issue_id: "011"
tags: [code-review, distribution]
dependencies: []
---

# Sign the installers

## Problem Statement

The installers are unsigned. Windows SmartScreen shows 'Windows protected your PC' and macOS Gatekeeper refuses to open the app on first launch, and users cannot tell a genuine build from a tampered one.

## Proposed Solutions

1. Publish SHA-256 checksums with each release and document the 'More info > Run anyway' and right-click > Open steps. Free, small effort.
2. Windows: a code-signing certificate or Azure Trusted Signing (paid). macOS: Apple Developer Program (paid, yearly) for signing and notarisation. Wire both into the workflow via secrets. Medium effort.

## Recommended Action

_To be filled in during triage._

## Acceptance Criteria

- [ ] Release page lists checksums
- [ ] (If the paid route is chosen) installers open without OS warnings

## Work Log

- 2026-11-13: Found in code review of the initial working tree. Not started.
