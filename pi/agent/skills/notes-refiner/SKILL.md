---
name: notes-refiner
description: Improves markdown notes for clarity and structure, then refreshes the searchable notes index. Use when polishing rough notes or preparing notes for retrieval.
---

# Notes Refiner

## Goal

Turn raw markdown into clean, coherent notes while preserving factual meaning.

## Workflow

1. Read the target note(s).
2. Normalize structure:
   - one H1 title
   - logical H2/H3 sections
   - concise bullet lists
   - explicit action items where relevant
3. Preserve all facts; do not fabricate details.
4. Write the refined note back.
5. Refresh index:

```bash
notes-index
```

If `notes-index` is not on PATH:

```bash
~/dots/infra/bin/notes-index
```

## Retrieval tip

Use the index file at:

`~/notes/.index/notes-index.jsonl`

to find likely note candidates by title, tags, and headings before deeper reading.
