return {
	"folke/snacks.nvim",
	priority = 1000,

	opts = {
		image = {
			enabled = true,
			doc = {
				inline = true,
				float = false,
				conceal = function()
					return false
				end,
			},
			math = {
				enabled = false,
			},
		},
	},
}
