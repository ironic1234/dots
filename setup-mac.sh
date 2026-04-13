#!/usr/bin/env bash
set -euo pipefail

DOTS="$(cd "$(dirname "$0")" && pwd)"
HOME_DIR="$HOME"

# ── Colors ─────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}==>${NC} $*"; }
ok()    { echo -e "${GREEN}  [ok]${NC} $*"; }
warn()  { echo -e "${YELLOW}  [warn]${NC} $*"; }
err()   { echo -e "${RED}  [err]${NC} $*"; }

# ── Helpers ────────────────────────────────────────────
command_exists() { command -v "$1" &>/dev/null; }

brew_install() {
    local pkg="$1"
    if brew list "$pkg" &>/dev/null; then
        ok "$pkg already installed"
    else
        info "Installing $pkg..."
        brew install "$pkg"
    fi
}

brew_install_cask() {
    local pkg="$1"
    if brew list --cask "$pkg" &>/dev/null; then
        ok "$pkg already installed"
    else
        info "Installing cask $pkg..."
        brew install --cask "$pkg"
    fi
}

link() {
    local src="$1" dst="$2"

    mkdir -p "$(dirname "$dst")"

    if [ -L "$dst" ] && [ "$(readlink "$dst")" = "$src" ]; then
        ok "$dst (already linked)"
        return
    fi

    if [ -e "$dst" ] || [ -L "$dst" ]; then
        local backup="${dst}.bak.$(date +%s)"
        warn "$dst -> $backup (backup)"
        mv "$dst" "$backup"
    fi

    ln -s "$src" "$dst"
    ok "$dst -> $src"
}

# ═══════════════════════════════════════════════════════
#  1. HOMEBREW
# ═══════════════════════════════════════════════════════
info "Checking Homebrew..."
if ! command_exists brew; then
    info "Installing Homebrew..."
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

    # Add to PATH for Apple Silicon
    if [ "$(arch)" = "arm64" ]; then
        eval "$(/opt/homebrew/bin/brew shellenv)"
    else
        eval "$(/usr/local/bin/brew shellenv)"
    fi
else
    ok "Homebrew installed"
fi

info "Updating Homebrew..."
brew update

# ── Taps ───────────────────────────────────────────────
info "Adding Homebrew taps..."
brew tap felixkratz/formulae 2>/dev/null && ok "felixkratz/formulae" || ok "felixkratz/formulae (already tapped)"

# ── Formulae ───────────────────────────────────────────
info "Installing Homebrew formulae..."

# Tiling WM stack
brew_install yabai
brew_install skhd
brew_install sketchybar
brew_install borders

# Terminal & shell
brew_install kitty
brew_install zsh
brew_install eza
brew_install fzf
brew_install fd
brew_install ripgrep
brew_install zoxide
brew_install vivid
brew_install tree

# Editors
brew_install neovim

# Languages & runtimes
brew_install python@3.13
brew_install node
brew_install go
brew_install rust
brew_install bun
brew_install lua
brew_install luajit

# LSP servers & formatters
brew_install stylua
brew_install prettier
brew_install latexindent
brew_install gopls
brew_install rust-analyzer
brew_install lua-language-server
brew_install texlab
brew_install verible
brew_install neocmakelsp
brew_install tree-sitter

# Build tools
brew_install cmake
brew_install make
brew_install gcc
brew_install ninja
brew_install meson
brew_install pkgconf

# CLI utilities
brew_install gh
brew_install git
brew_install jq
brew_install wget
brew_install btop
brew_install fastfetch
brew_install ncdu
brew_install pstree
brew_install htop
brew_install task
brew_install timewarrior

# Media
brew_install ffmpeg
brew_install yt-dlp
brew_install mpv
brew_install imagemagick

# Misc
brew_install spicetify-cli
brew_install mactop
brew_install deno
brew_install uv

# ── Casks ──────────────────────────────────────────────
info "Installing Homebrew casks..."

# Fonts
brew_install_cask font-hack-nerd-font
brew_install_cask font-jetbrains-mono-nerd-font

# Window management
brew_install_cask hammerspoon
brew_install_cask alt-tab

# Browsers
brew_install_cask firefox@nightly
brew_install_cask google-chrome

# Terminals
brew_install_cask kitty
brew_install_cask ghostty
brew_install_cask wezterm

# Editors / IDEs
brew_install_cask visual-studio-code@insiders
brew_install_cask zed
brew_install_cask codex

# Media
brew_install_cask iina
brew_install_cask spotify
brew_install_cask sioyek
brew_install_cask skim

# Dev tools
brew_install_cask docker-desktop

# Productivity
brew_install_cask tailscale-app
brew_install_cask slack@beta
brew_install_cask thunderbird
brew_install_cask transmission

# ── Mofi (GitHub release) ─────────────────────────────
info "Installing Mofi..."
if [ -d "/Applications/mofi.app" ]; then
    ok "mofi.app already installed"
else
    info "Downloading latest mofi release..."
    MOFI_ASSET_URL=$(gh release view --repo ronakpjain/mofi --json assets -q '.assets[] | select(.name == "mofi.app.tar.gz") | .url')
    if [ -n "$MOFI_ASSET_URL" ]; then
        gh release download --repo ronakpjain/mofi --pattern "mofi.app.tar.gz" --dir /tmp/mofi-dl --clobber
        tar -xzf /tmp/mofi-dl/mofi.app.tar.gz -C /tmp/mofi-dl
        mv /tmp/mofi-dl/mofi.app /Applications/mofi.app
        rm -rf /tmp/mofi-dl
        ok "mofi.app installed to /Applications"
    else
        warn "Could not find mofi.app.tar.gz in latest release"
    fi
fi

# ═══════════════════════════════════════════════════════
#  2. OH MY ZSH
# ═══════════════════════════════════════════════════════
info "Setting up Oh My Zsh..."
if [ ! -d "$HOME_DIR/.oh-my-zsh" ]; then
    info "Installing Oh My Zsh..."
    RUNZSH=no KEEP_ZSHRC=yes sh -c "$(curl -fsSL https://raw.githubusercontent.com/ohmyzsh/ohmyzsh/master/tools/install.sh)"
else
    ok "Oh My Zsh already installed"
fi

ZSH_CUSTOM="${ZSH_CUSTOM:-$HOME_DIR/.oh-my-zsh/custom}"

# zsh-autosuggestions
if [ ! -d "$ZSH_CUSTOM/plugins/zsh-autosuggestions" ]; then
    info "Installing zsh-autosuggestions..."
    git clone https://github.com/zsh-users/zsh-autosuggestions "$ZSH_CUSTOM/plugins/zsh-autosuggestions"
else
    ok "zsh-autosuggestions"
fi

# zsh-syntax-highlighting
if [ ! -d "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting" ]; then
    info "Installing zsh-syntax-highlighting..."
    git clone https://github.com/zsh-users/zsh-syntax-highlighting "$ZSH_CUSTOM/plugins/zsh-syntax-highlighting"
else
    ok "zsh-syntax-highlighting"
fi

# Catppuccin zsh syntax highlighting theme
info "Setting up Catppuccin zsh theme..."
mkdir -p "$HOME_DIR/.zsh"
if [ ! -f "$HOME_DIR/.zsh/catppuccin_mocha-zsh-syntax-highlighting.zsh" ]; then
    info "Downloading Catppuccin Mocha zsh-syntax-highlighting theme..."
    curl -fsSL \
        "https://raw.githubusercontent.com/catppuccin/zsh-syntax-highlighting/main/themes/catppuccin_mocha-zsh-syntax-highlighting.zsh" \
        -o "$HOME_DIR/.zsh/catppuccin_mocha-zsh-syntax-highlighting.zsh"
else
    ok "Catppuccin zsh theme"
fi

# ═══════════════════════════════════════════════════════
#  3. PYTHON VENV
# ═══════════════════════════════════════════════════════
info "Setting up Python venv..."
if [ ! -d "$HOME_DIR/.venv" ]; then
    python3 -m venv "$HOME_DIR/.venv"
    ok "Created ~/.venv"
else
    ok "~/.venv already exists"
fi

# ═══════════════════════════════════════════════════════
#  4. SYMLINKS
# ═══════════════════════════════════════════════════════
info "Symlinking dotfiles..."

# Shell
link "$DOTS/maczshrc"               "$HOME_DIR/.zshrc"

# Vim
link "$DOTS/vimrc"                  "$HOME_DIR/.vimrc"
link "$DOTS/vim"                    "$HOME_DIR/.vim"

# Neovim
link "$DOTS/macconfig/nvim"         "$HOME_DIR/.config/nvim"

# Kitty
link "$DOTS/macconfig/kitty"        "$HOME_DIR/.config/kitty"

# Ghostty
link "$DOTS/macconfig/ghostty"      "$HOME_DIR/.config/ghostty"

# Yabai (tiling WM)
link "$DOTS/macconfig/yabai"        "$HOME_DIR/.config/yabai"

# skhd (hotkey daemon)
link "$DOTS/macconfig/skhd"         "$HOME_DIR/.config/skhd"

# SketchyBar
link "$DOTS/macconfig/sketchybar"   "$HOME_DIR/.config/sketchybar"

# Hammerspoon
link "$DOTS/macconfig/hammerspoon"  "$HOME_DIR/.hammerspoon"

# JankyBorders
link "$DOTS/macconfig/borders"      "$HOME_DIR/.config/borders"

# OpenCode
link "$DOTS/macconfig/opencode"     "$HOME_DIR/.config/opencode"

# Pi
link "$DOTS/pi"                     "$HOME_DIR/.pi"

# Life infra configs
mkdir -p "$HOME_DIR/.timewarrior" "$HOME_DIR/.local/bin"
link "$DOTS/taskrc"                    "$HOME_DIR/.taskrc"
link "$DOTS/timewarrior.cfg"            "$HOME_DIR/.timewarrior/timewarrior.cfg"
link "$DOTS/infra/bin/life-sync"     "$HOME_DIR/.local/bin/life-sync"
link "$DOTS/infra/bin/notes-index"   "$HOME_DIR/.local/bin/notes-index"

# Mofi
link "$DOTS/macconfig/mofi"         "$HOME_DIR/.config/mofi"

# ═══════════════════════════════════════════════════════
#  5. NEOVIM PLUGINS
# ═══════════════════════════════════════════════════════
info "Installing Neovim plugins..."
if command_exists nvim; then
    nvim --headless "+lua vim.pack.update(nil, { force = true })" +qa 2>/dev/null || true
    ok "Neovim plugins synced"
else
    warn "nvim not found, skipping plugin install"
fi

# ═══════════════════════════════════════════════════════
#  6. START SERVICES
# ═══════════════════════════════════════════════════════
info "Starting services..."

# yabai
if pgrep -x yabai &>/dev/null; then
    ok "yabai already running"
else
    yabai --start-service 2>/dev/null && ok "yabai started" || warn "yabai start failed (needs SIP disabled for full features)"
fi

# skhd
if pgrep -x skhd &>/dev/null; then
    ok "skhd already running"
else
    skhd --start-service 2>/dev/null && ok "skhd started" || warn "skhd start failed"
fi

# SketchyBar
if pgrep -x sketchybar &>/dev/null; then
    ok "sketchybar already running"
else
    brew services start sketchybar 2>/dev/null && ok "sketchybar started" || warn "sketchybar start failed"
fi

# Borders
if pgrep -x borders &>/dev/null; then
    ok "borders already running"
else
    brew services start borders 2>/dev/null && ok "borders started" || warn "borders start failed"
fi

# Hammerspoon - launch at login is handled by macOS
if [ -d "/Applications/Hammerspoon.app" ]; then
    ok "Hammerspoon installed (launch at login via System Settings)"
else
    warn "Hammerspoon.app not found in /Applications"
fi

# ═══════════════════════════════════════════════════════
#  7. MACOS DEFAULTS (optional rice tweaks)
# ═══════════════════════════════════════════════════════
info "Applying macOS defaults..."

# Disable press-and-hold for keys in favor of key repeat
defaults write NSGlobalDomain ApplePressAndHoldEnabled -bool false

# Fast key repeat rate
defaults write NSGlobalDomain KeyRepeat -int 2
defaults write NSGlobalDomain InitialKeyRepeat -int 15

# Expand save/print panels by default
defaults write NSGlobalDomain NSNavPanelExpandedStateForSaveMode -bool true
defaults write NSGlobalDomain NSNavPanelExpandedStateForSaveMode2 -bool true

# Disable "Are you sure you want to open this application?"
defaults write com.apple.LaunchServices LSQuarantine -bool false

# Show hidden files in Finder
defaults write com.apple.finder AppleShowAllFiles -bool true

# Show all file extensions in Finder
defaults write NSGlobalDomain AppleShowAllExtensions -bool true

# Disable .DS_Store on network volumes
defaults write com.apple.desktopservices DSDontWriteNetworkStores -bool true

# Auto-hide Dock
defaults write com.apple.dock autohide -bool true

# Make Dock only appear after 10 seconds of hovering at the screen edge
defaults write com.apple.dock autohide-delay -float 10

# Apply Dock changes
killall Dock

ok "macos defaults applied (some require logout/reboot)"

# ═══════════════════════════════════════════════════════
#  DONE
# ═══════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}==> Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Restart your terminal (or run: source ~/.zshrc)"
echo "  2. Set keyboard remapping in System Settings:"
echo "     - Caps Lock -> Esc"
echo "     - Command -> Option"
echo "     - Option -> Control"
echo "     - Control -> Command"
echo "  3. Allow yabai accessibility in System Settings > Privacy & Security"
echo "  4. For yabai workspaces: disable SIP (csrutil disable in Recovery)"
echo "  5. Open Kitty once to register it, then Alt+K will launch it"
echo "  6. Open Hammerspoon once to grant accessibility permissions"
