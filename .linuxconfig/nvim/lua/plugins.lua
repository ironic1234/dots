local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not (vim.uv or vim.loop).fs_stat(lazypath) then
    vim.fn.system({
        "git",
        "clone",
        "--filter=blob:none",
        "https://github.com/folke/lazy.nvim.git",
        "--branch=stable", -- latest stable release
        lazypath,
    })
end
vim.opt.rtp:prepend(lazypath)

require("lazy").setup({
    require("plugins.autopairs"),
    require("plugins.autosave"),
    require("plugins.catppuccin"),
    require("plugins.telescope"),
    require("plugins.treesitter"),
    require("plugins.lsp"),
    require("plugins.highlight-colors"),
    require("plugins.alpha"),
    require("plugins.lualine"),
    require("plugins.wit"),
    require("plugins.oil"),
}, {
    ui = {
        border = "rounded",
    },
})
