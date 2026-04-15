#!/usr/bin/env bash
set -euo pipefail

if command -v playwright-cli >/dev/null 2>&1; then
  exec playwright-cli "$@"
fi

exec bunx @microsoft/playwright-cli "$@"
