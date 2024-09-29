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
vim.keymap.set("n", "<leader>fs", vim.cmd.StartupTime)
