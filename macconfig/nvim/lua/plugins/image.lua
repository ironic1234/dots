vim.pack.add({ "https://github.com/3rd/image.nvim" }, { confirm = false, load = true })

require("image").setup({
	integrations = {
		markdown = {
			enabled = true,
			floating_windows = false,
		},
		html = {
			enabled = false,
		},
	},
})
