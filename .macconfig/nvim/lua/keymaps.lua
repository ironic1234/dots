-- Leader defines
vim.g.mapleader = " "
vim.g.maplocalleader = " "

-- Telescope keymaps
local builtin = require("telescope.builtin")
vim.keymap.set("n", "<leader>ff", builtin.find_files, {})
vim.keymap.set("n", "<leader>fg", builtin.live_grep, {})
vim.keymap.set("n", "<leader>fb", builtin.buffers, {})
vim.keymap.set("n", "<leader>fh", builtin.help_tags, {})

-- Oil keymap
vim.keymap.set("n", "<leader>fo", vim.cmd.Oil, {})

-- Alpha keymap
vim.keymap.set("n", "<leader>fa", vim.cmd.Alpha)

-- StartupTime keymap
vim.keymap.set("n", "<leader>fs", "<Cmd>Lazy profile<CR>")

-- Go back to previous file
vim.keymap.set("n", "<leader>gb", "<Cmd>e#<CR>")

-- Autoquit insert mode
vim.api.nvim_create_autocmd("CursorHoldI", {
	pattern = "*",
	callback = function()
		vim.cmd("stopinsert")
	end,
})

vim.api.nvim_create_autocmd("InsertEnter", {
	pattern = "*",
	callback = function()
		vim.b.updaterestore = vim.o.updatetime
		vim.o.updatetime = 5000
	end,
})

vim.api.nvim_create_autocmd("InsertLeave", {
	pattern = "*",
	callback = function()
		if vim.b.updaterestore then
			vim.o.updatetime = vim.b.updaterestore
		end
	end,
})

-- Undotree
vim.keymap.set("n", "<leader>u", "<cmd>lua require('undotree').toggle()<cr>")

vim.keymap.set("n", "<leader>cc", function()
	require("duck").hatch("🐈")
end, {})
vim.keymap.set("n", "<leader>ck", function()
	require("duck").cook()
end, {})
vim.keymap.set("n", "<leader>ca", function()
	require("duck").cook_all()
end, {})
