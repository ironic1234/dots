return {
	"catppuccin/nvim",
	name = "catppuccin",
	event = { "VimEnter" },
	config = function()
		require("catppuccin").setup({
			transparent_background = true,
			no_italic = true,
			integrations = {
				treesitter = true,
				alpha = true,
				markdown = true,
				neotree = true,
				cmp = true,
				dap = true,
				which_key = true,
			},
			custom_highlights = function(colors)
				return {
					["@punctuation.bracket"] = { fg = colors.flamingo },
					["@punctuation.delimiter"] = { fg = colors.flamingo },
					["@punctuation.special"] = { fg = colors.flamingo },
					LineNr = { fg = colors.peach },
					WinSeparator = { fg = colors.peach },
					VertSplit = { fg = colors.peach },
					HeaderGroup = { fg = colors.peach },
					Pmenu = { bg = colors.base, fg = colors.peach },
				}
			end,
		})
	end,
}
