---
name: playwright-firefox
description: Live browser automation with Playwright CLI using Firefox by default, including headed or headless sessions and named profile support for parallel runs.
allowed-tools: bash read
---

# Playwright Firefox (live + headless + multi-profile)

This skill is optimized for browser automation with **Firefox fixed as default**.

## Capabilities

- Live visible automation (`--headed`) so you can watch mutations happen.
- Headless automation for faster/background runs.
- Named sessions (`-s=<session>`) so actions mutate the same browser instance.
- Optional named profiles for concurrent sessions with isolated state.

## Rules

- Use `playwright-cli` (or `bunx @microsoft/playwright-cli` fallback).
- Keep Firefox fixed as default (`--browser firefox`).
- Prefer named sessions and run actions through `bun run act ...`.
- For concurrent sessions, use different session names and (ideally) different profile names.

## Setup

```bash
cd ~/.pi/agent/skills/playwright-firefox
bun run setup
```

## Live visible workflow (headed)

```bash
cd ~/.pi/agent/skills/playwright-firefox

bun run open live "https://example.com" --headed
bun run act live snapshot
bun run act live click "text=More information..."
bun run screenshot live "./live.png"
bun run close live
```

## Headless workflow

```bash
cd ~/.pi/agent/skills/playwright-firefox

bun run open api "https://example.com" --headless
bun run act api snapshot
bun run screenshot api "./api.png"
bun run close api
```

(Shortcut: `bun run open:headless api "https://example.com"`)

## Parallel sessions with different profiles

```bash
cd ~/.pi/agent/skills/playwright-firefox

# Session A + profile A
bun run open work "https://mail.example.com" --headed --profile-name work

# Session B + profile B (simultaneous)
bun run open shop "https://shop.example.com" --headed --profile-name shop

# Drive each independently
bun run act work snapshot
bun run act shop snapshot

bun run sessions
bun run close work
bun run close shop
```

Managed profiles are stored at:
`~/.cache/pi/playwright-firefox/profiles/<profile-name>`

Helpers:

```bash
bun run profiles
bun run profile-path work
```

## One-shot capture

```bash
# defaults to headless
bun run capture "https://example.com" "./example-firefox.png"

# force headed
bun run capture:headed "https://example.com" "./example-firefox-headed.png"
```

## Notes

- `playwright-cli` limits writable paths; keep screenshot outputs inside the current directory.
- Reusing the same profile across simultaneous sessions can cause lock/contention issues.
