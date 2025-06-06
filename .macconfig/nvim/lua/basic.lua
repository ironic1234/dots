vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.numberwidth = 2
vim.opt.mouse = "a"
vim.opt.cursorline = true
vim.opt.cursorlineopt = "number"
vim.opt.ignorecase = true
vim.opt.smartcase = true
vim.opt.wrap = false
vim.opt.breakindent = true
vim.opt.tabstop = 4
vim.opt.shiftwidth = 4
vim.opt.showmode = false
vim.opt.laststatus = 3
vim.opt.expandtab = true
vim.loader.enable()
vim.opt.clipboard:append("unnamedplus")

-- Colorscheme
vim.cmd.colorscheme("catppuccin")

vim.g.have_nerd_font = true

vim.g.python_host_prog = "/opt/homebrew/opt/python/libexec/bin/python"
vim.g.python3_host_prog = "/opt/homebrew/opt/python/libexec/bin/python"
vim.g.loaded_perl_provider = 0
