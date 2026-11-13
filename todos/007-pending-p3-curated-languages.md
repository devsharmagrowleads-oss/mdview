---
status: pending
priority: p3
issue_id: "007"
tags: [code-review, performance, bundle-size]
dependencies: []
---

# Ship a curated code-highlighting language list

## Problem Statement

The editor bundles about 117 CodeMirror language chunks (COBOL, Z80, MUMPS and so on). Measured cost: about 230 KB of the installer.

## Proposed Solutions

1. Pass featureConfigs[Crepe.Feature.CodeMirror].languages as about 25 LanguageDescription.of({ name, alias, load }) entries (JS/TS, Python, JSON, HTML, CSS, SQL, YAML, Markdown, Rust, Go, C/C++, Java, XML, Shell, PowerShell, Dockerfile, TOML, Diff, Ruby, C#, Kotlin, Swift) and add the @codemirror/lang-* packages used to package.json. Filtering the stock list saves nothing; the list must be built by hand. Small effort. Unlisted languages render as plain monospace.

## Recommended Action

_To be filled in during triage._

## Acceptance Criteria

- [ ] Installer shrinks by roughly 200 KB
- [ ] The listed languages still highlight

## Work Log

- 2026-11-13: Found in code review of the initial working tree. Not started.
