#!/usr/bin/env bash
set -euo pipefail

session="${1:-live}"
out="${2:-./playwright-firefox.png}"

project_root="$(pwd -P)"
resolved_out="$out"
if [[ "$out" = /* ]]; then
  resolved_out="$out"
else
  resolved_out="$project_root/${out#./}"
fi

if [[ "$resolved_out" != "$project_root" && "$resolved_out" != "$project_root"/* ]]; then
  echo "Output path must be inside the current directory ($project_root) because playwright-cli restricts file writes to allowed roots." >&2
  exit 2
fi

mkdir -p "$(dirname "$resolved_out")"

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
"$script_dir/pw-session.sh" "$session" screenshot --filename "$out" --full-page
