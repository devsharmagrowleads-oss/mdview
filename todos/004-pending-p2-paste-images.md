---
status: pending
priority: p2
issue_id: "004"
tags: [code-review, feature, editor]
dependencies: []
---

# Support pasting and dropping images into a document

## Problem Statement

Pasted or dropped images are currently ignored on purpose (uploadConfig.uploader returns nothing in src/main.ts), because the editor would otherwise save them as temporary blob: addresses that break when the app closes. Users will expect paste to work.

## Proposed Solutions

1. Add a backend command that writes the image next to the document (for example images/<name>.png) and insert the relative path. For untitled documents ask the user to save first. Medium effort.
2. Embed as a base64 data URI. Small effort, but bloats the Markdown file.

## Recommended Action

_To be filled in during triage._

## Acceptance Criteria

- [ ] Pasting a screenshot into a saved document creates an image file and a relative link
- [ ] The image still shows after restarting the app

## Work Log

- 2026-11-13: Found in code review of the initial working tree. Not started.
