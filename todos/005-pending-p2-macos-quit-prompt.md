---
status: pending
priority: p2
issue_id: "005"
tags: [code-review, macos, data-integrity]
dependencies: []
---

# Check that Cmd+Q on macOS asks about unsaved changes

## Problem Statement

Unsaved-changes prompts run from the window close request. On macOS the default Quit menu item (Cmd+Q) may exit the app without one, discarding edits silently. This is a suspicion from reading the code; it has not been tested because no Mac build exists yet.

## Proposed Solutions

1. Test on a Mac build. If confirmed, handle RunEvent::ExitRequested in lib.rs: prevent the exit and ask the UI to run the same close flow. Small to medium effort.
2. Define a custom app menu whose Quit item closes the window instead. Medium effort.

## Recommended Action

_To be filled in during triage._

## Acceptance Criteria

- [ ] With unsaved edits, Cmd+Q shows the Save / Don't save / Cancel prompt
- [ ] Cancel keeps the app open with edits intact

## Work Log

- 2026-11-13: Found in code review of the initial working tree. Not started.
