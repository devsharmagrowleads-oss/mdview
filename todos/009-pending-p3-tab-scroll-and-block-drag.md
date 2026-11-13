---
status: pending
priority: p3
issue_id: "009"
tags: [code-review, ux]
dependencies: []
---

# Keep reading position per tab; block dragging on Windows

## Problem Statement

Two suspected UX gaps, neither confirmed by a test: (a) hidden tabs use display: none, so the webview may forget their scroll position when switching tabs; (b) Tauri's file drag-and-drop disables in-page dragging on Windows, so the editor's drag handle for reordering blocks likely does nothing there.

## Proposed Solutions

1. Save scrollTop per tab in activate() and restore it. Small effort.
2. For dragging: hide the drag handle on Windows via CSS, or turn off Tauri drag-drop and lose drop-to-open. Small effort; product decision.

## Recommended Action

_To be filled in during triage._

## Acceptance Criteria

- [ ] Switching away from and back to a tab keeps the scroll position
- [ ] No drag handle is shown where dragging cannot work

## Work Log

- 2026-11-13: Found in code review of the initial working tree. Not started.
