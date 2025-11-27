return {
	{
		"MeanderingProgrammer/render-markdown.nvim",
		event = "BufReadPre",
		dependencies = { "nvim-treesitter/nvim-treesitter", "nvim-tree/nvim-web-devicons" },
		opts = {},
	},
	{
		"Thiago4532/mdmath.nvim",
		event = "BufReadPre",
		dependencies = {
			"nvim-treesitter/nvim-treesitter",
		},
	},
	{
		"opdavies/toggle-checkbox.nvim",
	},
	{
		"bullets-vim/bullets.vim",
	},
}
