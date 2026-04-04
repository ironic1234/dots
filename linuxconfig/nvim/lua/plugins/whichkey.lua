vim.pack.add({ "https://github.com/folke/which-key.nvim" }, { confirm = false, load = true })

require("which-key").setup({
	win = {
		border = "rounded",
	},
})

vim.keymap.set("n", "<leader>?", function()
	require("which-key").show({ global = false })
end, { desc = "Buffer Local Keymaps (which-key)" })
