---
status: pending
priority: p2
issue_id: "006"
tags: [code-review, encoding]
dependencies: []
---

# Edit files that are not UTF-8

## Problem Statement

Files that are not valid UTF-8 (for example Windows-1252 notes) now open read-only so they cannot be damaged, and UTF-16 files are saved back as UTF-8. Users with such files cannot edit them in place with their encoding preserved.

## Proposed Solutions

1. Add the encoding_rs crate, detect the encoding, carry it in FileData/Tab and write the same encoding back. Medium effort.
2. Offer a one-time 'Convert to UTF-8 and edit' prompt. Small effort.

## Recommended Action

_To be filled in during triage._

## Acceptance Criteria

- [ ] A Windows-1252 file with accented characters can be edited and saved without changing unrelated bytes, or is explicitly converted with consent

## Work Log

- 2026-11-13: Found in code review of the initial working tree. Not started.
