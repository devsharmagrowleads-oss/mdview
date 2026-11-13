---
status: pending
priority: p2
issue_id: "003"
tags: [code-review, reliability, data-integrity]
dependencies: []
---

# Make saving atomic

## Problem Statement

write_text_file uses std::fs::write, which empties the file and then writes it. A crash or full disk in between destroys the only copy, and other programs watching the file briefly see it empty.

## Proposed Solutions

1. Write to a temporary file in the same folder, flush, then rename over the original. Small effort. Risk: rename replaces the file's identity, which can drop custom permissions/ACLs, break hard links and confuse sync clients such as OneDrive; test on all three platforms.
2. On Windows use ReplaceFileW, which preserves attributes and ACLs. Medium effort.

## Recommended Action

_To be filled in during triage._

## Acceptance Criteria

- [ ] Killing the app mid-save never leaves a truncated file
- [ ] Permissions of the saved file are unchanged
- [ ] Saving a file in a OneDrive folder still syncs

## Work Log

- 2026-11-13: Found in code review of the initial working tree. Not started.
