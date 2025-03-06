return {
	"catppuccin/nvim",
	name = "catppuccin",
	priority = 1000,
	config = function()
		require("catppuccin").setup({
			transparent_background = true,
			styles = {
				comments = { "italic" },
				conditionals = { "italic" },
				loops = { "italic" },
				functions = { "italic" },
				properties = { "italic" },
				types = { "italic" },
			},
			integrations = {
				treesitter = true,
			},
			custom_highlights = function(colors)
				return {
					["@punctuation.bracket"] = { fg = colors.flamingo },
					["@punctuation.delimiter"] = { fg = colors.flamingo },
					["@punctuation.special"] = { fg = colors.flamingo },
				}
			end,
		})
	end,
}
