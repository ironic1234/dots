# Personal Infrastructure

## 1) Architecture at a glance

### Scripts/programs
- `infra/bin/life-sync` — sync helper for task/time exports (+ notes index snapshot)
- `infra/bin/notes-index` — markdown indexer for LLM retrieval

### Pi workflow assets
- Pi settings: `pi/agent/settings.json` (skill commands enabled)
- Prompt templates: `pi/agent/prompts/`
  - `explore.md` (`/explore`)
  - `plan.md` (`/plan`)
  - `build.md` (`/build`)
  - `track.md` (`/track`)
  - `refine-note.md` (`/refine-note`)
- Skills: `pi/agent/skills/`
  - `explore-agent`
  - `plan-agent`
  - `build-agent`
  - `life-capture`
  - `notes-refiner`

---

## 2) Data locations

### Task/time sync data
- Root: `~/.local/share/life`
  - `task/`
  - `timewarrior/`
  - `exports/`

This directory is managed by `life-sync` as a git repo.

### Notes
- Root: `~/notes`
  - recommended capture file: `~/notes/inbox.md`
  - index output: `~/notes/.index/notes-index.jsonl`

Notes are now explicitly in `~/notes` (not under `~/.local/share/life`).

---

## 3) Full workflow

## A. Daily task/time tracking

Typical usage:
- `task add "Plan Q2 goals" +planning`
- `timew start planning`
- `timew stop`
- `task <id> done`

Then sync task/time state:
- `lsync`

`life-sync` does:
1. reindex notes,
2. export task/time snapshots,
3. commit local changes in `~/.local/share/life`,
4. pull/rebase,
5. push.

---

## B. Notes workflow

1. Capture notes in markdown under `~/notes`
2. Build/refresh search index:
   - `nindex`
3. Optionally refine notes with Pi:
   - `/refine-note <path>`
   - `/skill:notes-refiner ...`

The index file for retrieval is:
- `~/notes/.index/notes-index.jsonl`

`life-sync` also copies the latest notes index snapshot into:
- `~/.local/share/life/exports/notes-index.jsonl`

---

## C. Natural-language personal logging (Pi)

Use either:
- `/track ...`
- `/skill:life-capture ...`

These workflows convert natural language into concrete `task` + `timew` operations and confirm actions when needed.

Examples:
- `/track worked on interview prep for 50 minutes and add follow-up task`
- `/skill:life-capture start tracking project:taxes`

---

## D. Coding workflow (Pi)

Use a structured execution pipeline:
1. `/explore ...` or `/skill:explore-agent ...`
2. `/plan ...` or `/skill:plan-agent ...`
3. `/build ...` or `/skill:build-agent ...`

This enforces discovery-first thinking, explicit planning, and validated incremental implementation.

---

## 4) Command reference

### `life-sync`
- `life-sync init [remote-url]`
- `life-sync status`
- `life-sync pull`
- `life-sync push`
- `life-sync sync`

### `notes-index`
- default: `notes-index` (indexes `~/notes`)
- custom:
  - `notes-index --notes-dir <dir>`
  - `notes-index --notes-dir <dir> --output <file>`

---

## 5) Operational notes

- Task/time source of truth is `~/.local/share/life`.
- Notes source of truth is `~/notes`.
- Keep `~/notes` in markdown for best indexing + LLM refinement quality.
- Run `lsync` frequently to keep task/time data current across machines.
