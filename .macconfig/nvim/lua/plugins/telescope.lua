return {
	-- Telescope plugin and its dependencies
	"nvim-telescope/telescope.nvim",
	tag = "0.1.6",
	dependencies = { "nvim-lua/plenary.nvim", "nvim-tree/nvim-web-devicons" },
	config = function()
		require("telescope").setup()
	end,
}
