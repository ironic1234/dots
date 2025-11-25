return {
	"nvim-treesitter/nvim-treesitter",
	build = ":TSUpdate",
	config = function()
		local configs = require("nvim-treesitter.configs")

		configs.setup({
			highlight = { enable = true, disable = { "latex" } },
			indent = { enable = true },
		})
	end,
}
