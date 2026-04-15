#!/usr/bin/env bash
set -euo pipefail

session="${1:-live}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
"$script_dir/pw-session.sh" "$session" snapshot
