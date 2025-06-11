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

local dap = require("dap")

-- Basic controls
vim.keymap.set("n", "<leader>bp", dap.toggle_breakpoint, {}) -- breakpoint
vim.keymap.set("n", "<leader>bc", dap.continue, {}) -- continue
vim.keymap.set("n", "<leader>br", dap.restart, {}) -- restart
vim.keymap.set("n", "<leader>bt", dap.terminate, {}) -- terminate
vim.keymap.set("n", "<leader>bb", function()
	dap.set_breakpoint(vim.fn.input("Breakpoint condition: "))
end, {}) -- conditional breakpoint

-- Stepping
vim.keymap.set("n", "<leader>bs", dap.step_over, {}) -- step over
vim.keymap.set("n", "<leader>bi", dap.step_into, {}) -- step into
vim.keymap.set("n", "<leader>bo", dap.step_out, {}) -- step out
vim.keymap.set("n", "<leader>bx", dap.run_to_cursor, {}) -- run to cursor

-- REPL
vim.keymap.set("n", "<leader>brl", dap.repl.open, {}) -- open REPL
vim.keymap.set("n", "<leader>brq", dap.repl.close, {}) -- close REPL

-- UI toggle (if using dap-ui)
local dapui_ok, dapui = pcall(require, "dapui")
if dapui_ok then
	vim.keymap.set("n", "<leader>bu", dapui.toggle, {}) -- UI toggle
end

-- run.nvim keymaps
local run = require("run")
-- Runs the cached command
vim.keymap.set("n", "<leader>ri", run.run)
-- Prompts for a command, and overrides the cached one with it
vim.keymap.set("n", "<leader>ro", function()
	run.run(nil, true)
end)
-- Prompts for a command to run, without overriding
vim.keymap.set("n", "<leader>rc", run.run_prompt)
