---
status: pending
priority: p3
issue_id: "010"
tags: [code-review, security, ux]
dependencies: []
---

# Show where links go; narrow the opener permission

## Problem Statement

In view mode one click opens the browser with no indication of the real address, so [github.com](https://evil.example) works as phishing. Separately, opener:default in src-tauri/capabilities/default.json grants reveal_item_in_dir, which the app never uses.

## Proposed Solutions

1. Show the link address in a small status strip on hover. Small effort.
2. Replace opener:default with only the open-url permissions (check the exact permission names in the plugin docs). Small effort.
3. Add a navigation handler in Rust that denies everything except the app's own origin. Small effort.

## Recommended Action

_To be filled in during triage._

## Acceptance Criteria

- [ ] Hovering a link shows its real address
- [ ] External links still open in the browser

## Work Log

- 2026-11-13: Found in code review of the initial working tree. Not started.
