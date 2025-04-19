return {
	{
		"windwp/nvim-autopairs",
		event = "InsertEnter",
		config = true,
	},
	{
		"doums/tenaille.nvim",
		config = function()
			require("tenaille").setup({
				default_mapping = false,
			})
		end,
	},
}
