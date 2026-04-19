vim.pack.add(
	{ { src = "https://github.com/nvim-treesitter/nvim-treesitter", version = "main" } },
	{ confirm = false, load = true }
)

require("nvim-treesitter").setup({})

vim.api.nvim_create_autocmd({ "FileType" }, {
	callback = function()
		pcall(vim.treesitter.start)
	end,
})
