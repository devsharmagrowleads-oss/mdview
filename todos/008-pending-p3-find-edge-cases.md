---
status: pending
priority: p3
issue_id: "008"
tags: [code-review, find, quality]
dependencies: []
---

# Find-in-document edge cases

## Problem Statement

Known gaps in find: (a) long code blocks only render lines near the viewport, so matches further down may be missed (suspected, untested); (b) text either side of a hard line break is joined, so 'foo<br>bar' matches 'oba'; (c) on webviews without the CSS Highlight API the current match is not visibly marked.

## Proposed Solutions

1. Insert a separator at <br> in collectMatches. Small effort.
2. For code blocks, search the CodeMirror document text instead of its DOM. Medium effort.
3. Fallback: select the current match's range when highlights are unavailable. Small effort.

## Recommended Action

_To be filled in during triage._

## Acceptance Criteria

- [ ] A match on line 500 of a code block is found and scrolled to
- [ ] 'oba' does not match across a hard break

## Work Log

- 2026-11-13: Found in code review of the initial working tree. Not started.
