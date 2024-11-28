vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.numberwidth = 2
vim.opt.mouse = "a"
vim.opt.cursorline = true
vim.opt.cursorlineopt = "number"
vim.opt.ignorecase = true
vim.opt.smartcase = true
vim.opt.wrap = true
vim.opt.breakindent = true
vim.opt.tabstop = 4
vim.opt.shiftwidth = 4
vim.opt.expandtab = true
vim.loader.enable()
vim.opt.clipboard:append("unnamedplus")

-- Colorscheme
vim.cmd.colorscheme("catppuccin")
vim.api.nvim_set_hl(0, "LineNr", { fg = "#FAB387" })
