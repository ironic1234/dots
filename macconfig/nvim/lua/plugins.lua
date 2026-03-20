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
	require("plugins.colors"),
	require("plugins.telescope"),
	require("plugins.treesitter"),
	require("plugins.lsp"),
	require("plugins.highlight-colors"),
	require("plugins.alpha"),
	require("plugins.lualine"),
	require("plugins.oil"),
	require("plugins.surround"),
	require("plugins.neogit"),
	require("plugins.go-up"),
	require("plugins.dap"),
	require("plugins.teamtype"),
	require("plugins.dropbar"),
	require("plugins.snacks"),
	require("plugins.markdown"),
	require("plugins.zen-mode"),
	require("plugins.fidget"),
	require("plugins.whichkey"),
}, {
	ui = {
		border = "rounded",
	},
})
