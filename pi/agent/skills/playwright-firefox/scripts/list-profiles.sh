#!/usr/bin/env bash
set -euo pipefail

root="$HOME/.cache/pi/playwright-firefox/profiles"
mkdir -p "$root"

if ! find "$root" -mindepth 1 -maxdepth 1 -type d | read -r _; then
  echo "No managed profiles yet."
  echo "Create one by opening a session with:"
  echo "  bun run open live https://example.com --profile-name work"
  exit 0
fi

echo "Managed Firefox profiles:"
find "$root" -mindepth 1 -maxdepth 1 -type d -printf '  - %f\n' | sort
