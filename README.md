# Dotfiles

This repository stores my personal configuration for macOS and Linux.

## [Neovim](https://neovim.io/)
Text Editor of choice
- Vim motions
- [Catppuccin](https://github.com/catppuccin/nvim) Theme
- [Plugins](https://github.com/folke/lazy.nvim) - Plugin manager
    - [Autopairs](https://github.com/windwp/nvim-autopairs) - Automatically close braces, parentheses and quotes
    - [Alpha](https://github.com/goolord/alpha-nvim) - Startup screen (catvim)
    - [Autosave](https://github.com/0x00-ketsu/autosave.nvim) - Automatically save on edits
    - [Autotag](https://github.com/windwp/nvim-ts-autotag) - Automatically close html tags
    - [Highlight-Colors](https://github.com/brenoprata10/nvim-highlight-colors) - Highlights color values with corresponding color
    - LSP - Language features like diagnostics, completion, and formatting
        - [Mason](https://github.com/williamboman/mason.nvim) - Package manager
        - [LSPConfig](https://github.com/neovim/nvim-lspconfig) - Configures servers for use with Neovim
        - [Mason-Conform](https://github.com/zapling/mason-conform.nvim) - Integrate formatters with Mason
        - [Conform](https://github.com/stevearc/conform.nvim) - Formatting text
        - [Lazydev](https://github.com/folke/lazydev.nvim) - Proper lua integration for config and plugin development
        - [nvim-cmp](https://github.com/hrsh7th/nvim-cmp) - Completion menu
        - [LuaSnip](https://github.com/L3MON4D3/LuaSnip) - Snippets
        - [Copilot](https://github.com/zbirenbaum/copilot.lua) - AI-powered suggestions
        - [comment.nvim](https://github.com/numToStr/Comment.nvim) - Commenting
    - [Lualine](https://github.com/nvim-lualine/lualine.nvim) - Better status bar
    - [Oil](https://github.com/stevearc/oil.nvim) - File manager as a buffer
    - [Telescope](https://github.com/nvim-telescope/telescope.nvim) - Fuzzy finding files
    - [Treesitter](https://github.com/nvim-treesitter/nvim-treesitter) - Parses languages and provides syntax highlighting
    - [Vimtex](https://github.com/lervag/vimtex) - Latex integration
    - [Wit](https://github.com/Aliqyan-21/wit.nvim) - Google search from Neovim
    - [DAP](https://github.com/mfussenegger/nvim-dap) - Debugging
    - [Neogit](https://github.com/NeogitOrg/neogit) - Git interface
    - [Live Preview](https://github.com/brianhuster/live-preview.nvim) - Render Markdown previews
    - [Typr](https://github.com/nvzone/typr) - Typing practice
    - [Undotree](https://github.com/jiaoshijie/undotree) - Better undo history
    - [Go-Up](https://github.com/nullromo/go-up.nvim) - Move up directories quickly
    - [LeetCode](https://github.com/kawre/leetcode.nvim) - Solve LeetCode problems
    - [Duck](https://github.com/tamton-aquib/duck.nvim) - Rubber duck debugging
    - [Zen Mode](https://github.com/folke/zen-mode.nvim) - Distraction-free mode
## [Kitty](https://github.com/kovidgoyal/kitty)
Terminal emulator of choice
- [Catppuccin](https://github.com/catppuccin/kitty) Theme
- [Hack Nerd Font Mono](https://github.com/ryanoasis/nerd-fonts)
## [zsh](https://www.zsh.org/)
Shell of choice
- [Oh-my-zsh](https://github.com/ohmyzsh/ohmyzsh) for configuration
- Git, syntax highlighting, autosuggestions, and interactive cd plugins.
- alanpeabody prompt
## [Yabai](https://github.com/koekeishiya/yabai)
Tiling window manager for MacOS
- I have disabled SIP which allows for workspaces
- Inactive windows are slightly transparent
## [MacOS](https://www.apple.com/macos/macos-sequoia/)
OS that comes with the best laptops
- Command -> Option (Alt in windowsland)
- Option -> Control (Ctrl in windowsland)
- Control -> Command (Windows key(?) in windowsland)
- Caps Lock -> Esc
## [skhd](https://github.com/koekeishiya/skhd)
Keybindings
- Alt - e: BSP layout
- Alt - s: Stack layout
- Alt - f: Toggle fullscreen
- Alt - k: Kitty
- Alt - r: Open mofi
- Alt - t: Firefox Nightly
- Alt - a: Use warpd hints
- Alt - j: Focus left monitor
- Alt - l: Focus right monitor
- Alt - o: Focus west
- Alt - p: Focus east
- Ctrl - Alt - left: Send window to left monitor
- Ctrl - Alt - right: Send window to right monitor
- Alt - {up, down, left, right}: Focus window in direction
- Alt - Shift - {up, down, left, right}: Switch with window in direction
- Shift - Alt - {1-8}: Send window to corresponding workspace
- Alt - {1-8}: Switch to corresponding workspace
- Alt - w: Send Cmd - w to window = Close tab
- Alt - q: Send Cmd - q to window = Kill program
- Alt - x: Close window
- Alt - c: Open Neko
## [SketchyBar](https://github.com/FelixKratz/SketchyBar)
Status bar to take up awkward notch space
## [JankyBorders](https://github.com/FelixKratz/JankyBorders)
Borders around windows
- Orange - active windows
- Gray - inactive windows
## [Firefox](https://www.mozilla.org/en-US/firefox/)
Browser of choice
- [Catppuccin](https://github.com/catppuccin/firefox) Theme
- [Vimium](https://github.com/philc/vimium) - Vim motions in firefox
- [Dark Reader](https://github.com/darkreader/darkreader) - Turn any website into [catppuccin](https://github.com/catppuccin/dark-reader)
- [Stylus](https://github.com/openstyles/stylus) - Userstyles = [catppuccin](https://github.com/catppuccin/userstyles) for many common websites
- [UBlock Origin](https://github.com/gorhill/uBlock) - Adblocker that works
