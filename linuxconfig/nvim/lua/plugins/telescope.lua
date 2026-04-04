vim.pack.add({
	"https://github.com/nvim-lua/plenary.nvim",
	"https://github.com/nvim-tree/nvim-web-devicons",
	"https://github.com/nvim-telescope/telescope-ui-select.nvim",
	"https://github.com/nvim-telescope/telescope.nvim",
}, { confirm = false, load = true })

local telescope = require("telescope")
telescope.setup({
	extensions = {
		["ui-select"] = {
			require("telescope.themes").get_dropdown(),
		},
	},
	pickers = {
		find_files = {
			hidden = true,
		},
	},
})
telescope.load_extension("ui-select")
