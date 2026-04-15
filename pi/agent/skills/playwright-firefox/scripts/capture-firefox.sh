#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: bun run capture "<url>" ["./output.png"] [options]

Options:
  --headless                 Capture using headless browser (default)
  --headed                   Capture using visible browser window
  --profile-name <name>      Use managed profile at ~/.cache/pi/playwright-firefox/profiles/<name>
  --profile <path>           Use explicit profile directory path
  -h, --help                 Show this help
EOF
}

expand_home() {
  local p="$1"
  if [[ "$p" == "~" ]]; then
    printf '%s\n' "$HOME"
    return
  fi
  if [[ "$p" == ~/* ]]; then
    printf '%s\n' "$HOME/${p#~/}"
    return
  fi
  printf '%s\n' "$p"
}

mode="headless"
profile_name=""
profile_path=""
positionals=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --headless)
      mode="headless"
      shift
      ;;
    --headed)
      mode="headed"
      shift
      ;;
    --profile-name)
      [[ $# -ge 2 ]] || { usage; exit 1; }
      profile_name="$2"
      shift 2
      ;;
    --profile)
      [[ $# -ge 2 ]] || { usage; exit 1; }
      profile_path="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      while [[ $# -gt 0 ]]; do
        positionals+=("$1")
        shift
      done
      ;;
    *)
      positionals+=("$1")
      shift
      ;;
  esac
done

if [[ ${#positionals[@]} -lt 1 || ${#positionals[@]} -gt 2 ]]; then
  usage
  exit 1
fi

url="${positionals[0]}"
out="${positionals[1]:-./playwright-firefox.png}"
session="capture-$$"

if [[ -n "$profile_name" && -n "$profile_path" ]]; then
  echo "Use either --profile-name or --profile, not both." >&2
  exit 1
fi

if [[ -n "$profile_name" ]]; then
  if [[ ! "$profile_name" =~ ^[a-zA-Z0-9._-]+$ ]]; then
    echo "Invalid --profile-name '$profile_name'. Use letters, numbers, dot, underscore, or hyphen." >&2
    exit 1
  fi
  profile_path="$HOME/.cache/pi/playwright-firefox/profiles/$profile_name"
fi

if [[ -n "$profile_path" ]]; then
  profile_path="$(expand_home "$profile_path")"
  mkdir -p "$profile_path"
fi

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
cleanup() {
  "$script_dir/pw-session.sh" "$session" close >/dev/null 2>&1 || true
}
trap cleanup EXIT

open_args=(open "$url" --browser firefox)
if [[ "$mode" == "headed" ]]; then
  open_args+=(--headed)
fi
if [[ -n "$profile_path" ]]; then
  open_args+=(--profile "$profile_path")
else
  open_args+=(--persistent)
fi

"$script_dir/pw-session.sh" "$session" "${open_args[@]}"
"$script_dir/pw-session.sh" "$session" screenshot --filename "$out" --full-page
"$script_dir/pw-session.sh" "$session" close
trap - EXIT
