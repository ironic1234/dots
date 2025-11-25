return {
	"folke/snacks.nvim",
	priority = 1000,

	opts = {
		image = {
			enabled = true,
			doc = {
				conceal = function()
					return false
				end,
			},
		},
	},
}
