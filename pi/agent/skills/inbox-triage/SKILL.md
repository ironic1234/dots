---
name: inbox-triage
description: Processes ~/notes/inbox.md by classifying captured items into school, work, projects, or personal-learning notes. Use during daily/weekly inbox cleanup.
---

# Inbox Triage

Use this skill to empty `~/notes/inbox.md` into the structured notes layout.

## Notes layout

- `~/notes/school/`
- `~/notes/work/`
- `~/notes/projects/`
- `~/notes/personal-learning/`

Preferred subfolders:

- School: `courses/`, `admin/`
- Projects: `active/`, `backlog/`, `archive/`
- Personal learning: `topics/`, `courses/`, `books/`, `labs/`

## Operating mode

1. Read `~/notes/inbox.md`.
2. Parse each actionable line/bullet into one unit.
3. Propose destination file(s) and a short reason for each move.
4. Ask for confirmation before editing files.
5. On confirmation:
   - append each item to its destination note,
   - remove moved items from `inbox.md`,
   - keep unclear items in inbox under an `## Unsorted` section.
6. Rebuild index:

```bash
notes-index --notes-dir ~/notes
```

1. Suggest syncing:

```bash
life-sync sync
```

## File conventions

- Prefer appending to existing notes when they clearly match.
- If no good target exists, create one using:
  - `YYYY-MM-DD-<topic>.md` for general notes
- Preserve original wording; only do light cleanup for readability.

## Guardrails

- Never delete content without explicit confirmation.
- If classification confidence is low, keep item in inbox and label as unsorted.
- Keep edits minimal and reversible.
