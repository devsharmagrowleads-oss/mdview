---
title: Atlas launch plan
owner: product
status: draft
---

# Atlas launch plan

A short plan for shipping **Atlas 2.0**. This file is plain Markdown: MDView shows it *formatted*, and lets you edit it in place.

## Checklist

- [x] Freeze the feature list
- [x] Write the migration guide
- [ ] Record the demo video
- [ ] Publish the release notes

## Timeline

| Milestone | Owner | Date | Status |
| --- | --- | --- | --- |
| Beta build | Priya | 4 March | Done |
| Docs review | Marco | 11 March | In progress |
| Public launch | Team | 18 March | Planned |

## Word count script

```python
from pathlib import Path

for note in sorted(Path("notes").glob("*.md")):
    words = len(note.read_text().split())
    print(f"{note.name}: {words} words")
```

> Ship small, ship often. Every release should be boring.

## Sizing

Expected load is $R = \frac{users \times requests}{86400}$ requests per second, so 50,000 users at 40 requests a day is about 23 per second.

![MDView logo](logo.png)

## Open questions

1. Do we keep the old API alive for one more quarter?
2. Who signs off on the pricing page?
