vim.pack.add({
	"https://github.com/nvim-tree/nvim-web-devicons",
	"https://github.com/nvim-lualine/lualine.nvim",
}, { confirm = false, load = true })

require("lualine").setup({
	sections = {
		lualine_x = { "encoding", "filetype" },
	},
	options = {
		globalstatus = true,
		theme = "catppuccin-nvim",
	},
})
