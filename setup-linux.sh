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

yay_install() {
    local pkg="$1"
    if yay -Q "$pkg" &>/dev/null; then
        ok "$pkg already installed"
    else
        info "Installing $pkg..."
        yay -S --noconfirm "$pkg"
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
#  1. YAY (AUR Helper)
# ═══════════════════════════════════════════════════════
info "Checking yay..."
if ! command_exists yay; then
    info "Installing yay..."
    cd /tmp
    git clone https://aur.archlinux.org/yay.git
    cd yay
    makepkg -si --noconfirm
    cd /
    rm -rf /tmp/yay
    ok "yay installed"
else
    ok "yay installed"
fi

info "Updating packages..."
yay -Syu --noconfirm

# ── Tiling WM Stack ────────────────────────────────────
info "Installing Hyprland stack..."
yay_install hyprland
yay_install waybar
yay_install niri
yay_install rofi

# Hyprland utilities
yay_install hyprlock
yay_install hyprpaper
yay_install awww-bin  # animated wallpaper (AUR)
yay_install uwsm  # universal wayland session manager

# ── Terminal & shell ───────────────────────────────────
info "Installing terminal & shell packages..."
yay_install kitty
yay_install zsh
yay_install eza
yay_install fzf
yay_install fd
yay_install ripgrep
yay_install zoxide
yay_install vivid
yay_install tree

# ── Editors ────────────────────────────────────────────
info "Installing editors..."
yay_install neovim

# ── Languages & runtimes ───────────────────────────────
info "Installing languages & runtimes..."
yay_install python
yay_install nodejs
yay_install go
yay_install rust
yay_install lua
yay_install luajit

# ── LSP servers & formatters ───────────────────────────
info "Installing LSP servers & formatters..."
yay_install stylua
yay_install prettier
yay_install gopls
yay_install rust-analyzer
yay_install lua-language-server

# ── Build tools ────────────────────────────────────────
info "Installing build tools..."
yay_install cmake
yay_install make
yay_install gcc
yay_install ninja
yay_install meson
yay_install pkgconf

# ── CLI utilities ──────────────────────────────────────
info "Installing CLI utilities..."
yay_install gh
yay_install git
yay_install jq
yay_install wget
yay_install btop
yay_install fastfetch
yay_install ncdu
yay_install pstree
yay_install htop

# ── Wayland-specific utilities ────────────────────────
info "Installing Wayland utilities..."
yay_install grim       # screenshot
yay_install slurp     # region selection for screenshots
yay_install wl-clipboard  # provides wl-copy and wl-paste
yay_install playerctl  # media player control
yay_install brightnessctl  # backlight control
yay_install wireplumber  # audio/session manager (wpctl)
yay_install pipewire
yay_install pipewire-alsa
yay_install pipewire-pulse
yay_install pavucontrol  # audio mixer GUI
yay_install swaybg       # wallpaper (used by niri)
yay_install wl-kbptr     # keyboard-driven pointer

# ── Media ─────────────────────────────────────────────
info "Installing media packages..."
yay_install ffmpeg
yay_install yt-dlp
yay_install mpv
yay_install imagemagick

# ── AUR packages ──────────────────────────────────────
info "Installing AUR packages..."
yay_install visual-studio-code-bin
yay_install zed
yay_install spotify

# ── Fonts ─────────────────────────────────────────────
info "Installing fonts..."
yay_install ttf-hack
yay_install ttf-jetbrains-mono
yay_install noto-fonts
yay_install noto-fonts-cjk

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
    python -m venv "$HOME_DIR/.venv"
    ok "Created ~/.venv"
else
    ok "~/.venv already exists"
fi

# ═══════════════════════════════════════════════════════
#  4. SYMLINKS
# ═══════════════════════════════════════════════════════
info "Symlinking dotfiles..."

# Shell
link "$DOTS/linuxzshrc"             "$HOME_DIR/.zshrc"

# Vim
link "$DOTS/vimrc"                  "$HOME_DIR/.vimrc"
link "$DOTS/vim"                    "$HOME_DIR/.vim"

# Neovim
link "$DOTS/linuxconfig/nvim"       "$HOME_DIR/.config/nvim"

# Kitty
link "$DOTS/linuxconfig/kitty"      "$HOME_DIR/.config/kitty"

# Hyprland
link "$DOTS/linuxconfig/hypr"       "$HOME_DIR/.config/hypr"

# Waybar
link "$DOTS/linuxconfig/waybar"     "$HOME_DIR/.config/waybar"

# Niri
link "$DOTS/linuxconfig/niri"       "$HOME_DIR/.config/niri"

# Rofi
link "$DOTS/linuxconfig/rofi"       "$HOME_DIR/.config/rofi"

# OpenCode
link "$DOTS/linuxconfig/opencode"   "$HOME_DIR/.config/opencode"

# ═══════════════════════════════════════════════════════
#  5. NEOVIM PLUGINS
# ═══════════════════════════════════════════════════════
info "Installing Neovim plugins..."
if command_exists nvim; then
    nvim --headless "+Lazy! sync" +qa 2>/dev/null || true
    ok "Neovim plugins synced"
else
    warn "nvim not found, skipping plugin install"
fi

# ═══════════════════════════════════════════════════════
#  6. UWSM SERVICE
# ═══════════════════════════════════════════════════════
info "Setting up UWSM..."

# System already provides /usr/share/wayland-sessions/hyprland-uwsm.desktop
# and niri.desktop. No custom .desktop file needed.
ok "Wayland sessions available (hyprland-uwsm, niri)"

# ═══════════════════════════════════════════════════════
#  DONE
# ═══════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}==> Setup complete!${NC}"
echo ""
echo "Next steps:"
echo "  1. Restart your terminal (or run: source ~/.zshrc)"
echo "  2. Log into tty1 (Ctrl+Alt+F1) and run: uwsm start select"
echo "  3. Select 'Hyprland (uwsm-managed)' or 'Niri' from the menu"
echo "  4. If on NVIDIA, ensure /etc/mkinitcpio.conf has MODULES=(nvidia nvidia_modeset nvidia_uvm nvidia_drm)"
echo "     Then run: sudo mkinitcpio -P"
echo "  5. Set your wallpaper at ~/Pictures/CatppuccinMocha-Kurzgesagt-BlackHole3.png"
echo "     (or update hyprland.conf and hyprpaper.conf to point to your actual wallpaper)"
echo "  6. Open Neovim and run :Lazy sync if plugins didn't install"
echo "  7. Configure your monitor layout in ~/.config/hypr/monitors.conf"
echo "  8. If audio doesn't work: wpctl status and pavucontrol to check PipeWire"
