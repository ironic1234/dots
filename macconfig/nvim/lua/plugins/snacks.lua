vim.pack.add({ "https://github.com/folke/snacks.nvim" }, { confirm = false, load = true })

require("snacks").setup({
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
})
