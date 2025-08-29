return {
	"vyfor/cord.nvim",
	build = ":Cord update",
	config = function()
		require("cord").setup({
			display = {
				theme = "catppuccin",
				flavor = "accent",
			},
		})
	end,
}
