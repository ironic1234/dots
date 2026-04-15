#!/usr/bin/env bash
set -euo pipefail

session="${1:-}"
command_name="${2:-}"

if [[ -z "$session" || -z "$command_name" ]]; then
  echo 'Usage: bun run act <session> <command> [args...]' >&2
  echo 'Example: bun run act live click "text=Sign in"' >&2
  exit 1
fi

shift 2

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
"$script_dir/pw-session.sh" "$session" "$command_name" "$@"
