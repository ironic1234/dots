#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: bun run open [session] [url] [options]

Options:
  --headless                 Open in headless mode (no visible window)
  --headed                   Open in headed mode (visible window)
  --profile-name <name>      Use managed profile at ~/.cache/pi/playwright-firefox/profiles/<name>
  --profile <path>           Use explicit profile directory path
  --persistent               Use persistent context (default when no profile is provided)
  --no-persistent            Disable persistent context (ignored if --profile/--profile-name is used)
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

session="live"
url="about:blank"
mode="headed"
persistent="1"
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
    --persistent)
      persistent="1"
      shift
      ;;
    --no-persistent)
      persistent="0"
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

if [[ ${#positionals[@]} -gt 2 ]]; then
  usage
  exit 1
fi

if [[ ${#positionals[@]} -ge 1 ]]; then
  session="${positionals[0]}"
fi
if [[ ${#positionals[@]} -ge 2 ]]; then
  url="${positionals[1]}"
fi

if [[ -n "$profile_name" && -n "$profile_path" ]]; then
  echo "Use either --profile-name or --profile, not both." >&2
  exit 1
fi

if [[ -n "$profile_name" ]]; then
  if [[ ! "$profile_name" =~ ^[a-zA-Z0-9._-]+$ ]]; then
    echo "Invalid --profile-name '$profile_name'. Use letters, numbers, dot, underscore, or hyphen." >&2
    exit 1
  fi
  managed_root="$HOME/.cache/pi/playwright-firefox/profiles"
  profile_path="$managed_root/$profile_name"
fi

if [[ -n "$profile_path" ]]; then
  profile_path="$(expand_home "$profile_path")"
  mkdir -p "$profile_path"
fi

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cmd=(open "$url" --browser firefox)

if [[ "$mode" == "headed" ]]; then
  cmd+=(--headed)
fi

if [[ -n "$profile_path" ]]; then
  cmd+=(--profile "$profile_path")
elif [[ "$persistent" == "1" ]]; then
  cmd+=(--persistent)
fi

"$script_dir/pw-session.sh" "$session" "${cmd[@]}"
