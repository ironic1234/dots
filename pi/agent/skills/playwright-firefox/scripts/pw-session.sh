#!/usr/bin/env bash
set -euo pipefail

session="${1:-}"
if [[ -z "$session" ]]; then
  echo 'Usage: scripts/pw-session.sh <session> <command> [args...]' >&2
  exit 1
fi

shift
if [[ $# -eq 0 ]]; then
  echo 'Usage: scripts/pw-session.sh <session> <command> [args...]' >&2
  exit 1
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
"$script_dir/pw-cli.sh" "-s=$session" "$@"
