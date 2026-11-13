---
status: pending
priority: p2
issue_id: "002"
tags: [code-review, security, architecture]
dependencies: []
---

# Restrict the backend file commands to files the user opened

## Problem Statement

read_text_file and write_text_file in src-tauri/src/lib.rs accept any path. A document cannot reach them today (the review found no way for document content to run script), but one future XSS in the editor stack (Milkdown, KaTeX, DOMPurify, CodeMirror) would become read-any-file and write-any-file, which is code execution via the Startup folder.

## Proposed Solutions

1. Keep an allowlist in Rust state. Paths enter it only from launch arguments, the single-instance callback, the macOS Opened event and dialog results; move the open/save dialogs into Rust commands so paths never round-trip through JS. write_text_file accepts only allowlisted paths; read_text_file also accepts Markdown siblings reached by a link. Medium effort.
2. Use tauri-plugin-fs with a runtime scope instead of custom commands. Medium effort, more dependencies.

## Recommended Action

_To be filled in during triage._

## Acceptance Criteria

- [ ] Invoking write_text_file from the webview console with a path that was never opened fails
- [ ] Open, Save, Save As, drag-drop, relative links and live reload still work

## Work Log

- 2026-11-13: Found in code review of the initial working tree. Not started.
