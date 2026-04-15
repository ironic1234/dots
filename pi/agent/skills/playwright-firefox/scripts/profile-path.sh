#!/usr/bin/env bash
set -euo pipefail

name="${1:-}"
if [[ -z "$name" ]]; then
  echo 'Usage: bun run profile-path <profile-name>' >&2
  exit 1
fi

if [[ ! "$name" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  echo "Invalid profile name '$name'. Use letters, numbers, dot, underscore, or hyphen." >&2
  exit 1
fi

path="$HOME/.cache/pi/playwright-firefox/profiles/$name"
mkdir -p "$path"
printf '%s\n' "$path"
