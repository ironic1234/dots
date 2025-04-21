return {
	"nvim-lualine/lualine.nvim",
	dependencies = { "nvim-tree/nvim-web-devicons" },
	config = function()
		require("lualine").setup({
			sections = {
				lualine_x = { "encoding", "filetype" },
			},
			options = {
				globalstatus = true,
				theme = "catppuccin",
			},
		})
	end,
}
