# Personal Infrastructure

## 1) Architecture at a glance

### Scripts/programs
- `infra/bin/life-sync` — sync helper for task/time exports + notes indexing + git sync
- `infra/bin/notes-index` — markdown indexer for LLM retrieval

### Dotfile config files in this repo
- `taskrc` → symlinked to `~/.taskrc`
- `timewarrior.cfg` → symlinked to `~/.timewarrior/timewarrior.cfg`

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
  - `inbox-triage`

---

## 2) Data locations

### Life sync repo (git)
- Root: `~/.local/share/life`
  - `task/`
  - `timewarrior/`
  - `exports/`
  - `notes/`

This directory is managed by `life-sync` as a git repo.

### Notes location
- Canonical notes path: `~/.local/share/life/notes`
- Convenience path: `~/notes` (symlink to the path above)
- Recommended capture file: `~/notes/inbox.md`
- Index output: `~/notes/.index/notes-index.jsonl`

### Current remote
- `~/.local/share/life` uses git remote `origin`
- Current URL: `https://github.com/ronakpjain/life.git`

---

## 3) Full workflow

## A. Daily task/time tracking

Typical usage:
- `task add "Plan Q2 goals" +planning`
- `timew start planning`
- `timew stop`
- `task <id> done`

Then sync state:
- `lsync`

`life-sync` does:
1. reindex notes,
2. export task/time snapshots,
3. stage/commit local changes in `~/.local/share/life` (including `notes/` when notes live under life repo),
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
4. Triage inbox with Pi:
   - `/skill:inbox-triage`

Index file for retrieval:
- `~/notes/.index/notes-index.jsonl`

`life-sync` also copies latest notes index snapshot into:
- `~/.local/share/life/exports/notes-index.jsonl`

Notes layout currently includes:
- `~/notes/school/`
- `~/notes/projects/`
- `~/notes/personal-learning/`

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

Use structured execution pipeline:
1. `/explore ...` or `/skill:explore-agent ...`
2. `/plan ...` or `/skill:plan-agent ...`
3. `/build ...` or `/skill:build-agent ...`

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

### Useful aliases
- `lsync` → `life-sync sync`
- `lpull` → `life-sync pull`
- `lpush` → `life-sync push`
- `nindex` → `notes-index`

---

## 5) Operational notes

- Single source-of-truth repo: `~/.local/share/life`.
- Notes are versioned inside that repo at `notes/`.
- `~/notes` is a convenience symlink; use it normally.
- Keep notes in markdown for best indexing + LLM refinement quality.
- Run `lsync` frequently to keep task/time/notes current across machines.
