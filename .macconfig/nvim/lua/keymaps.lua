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
vim.keymap.set("n", "<leader>u", function()
	require("undotree").toggle()
end)

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

-- Dropbar
local dropbar_api = require("dropbar.api")
vim.keymap.set("n", "<leader>;", dropbar_api.pick, { desc = "Pick symbols in winbar" })
vim.keymap.set("n", "[;", dropbar_api.goto_context_start, { desc = "Go to start of current context" })
vim.keymap.set("n", "];", dropbar_api.select_next_context, { desc = "Select next context" })

-- LSP
vim.keymap.set("n", "gd", function()
	vim.lsp.buf.definition()
end)
vim.keymap.set("n", "gi", function()
	vim.lsp.buf.implementation()
end)
vim.keymap.set("n", "gh", function()
	vim.lsp.buf.hover()
end)
vim.keymap.set("n", "gD", function()
	vim.diagnostic.open_float()
end)
vim.keymap.set("n", "gr", function()
	vim.lsp.buf.references()
end)
vim.keymap.set("n", "ga", function()
	vim.lsp.buf.code_action()
end)
vim.keymap.set("n", "<leader>l", function()
	vim.lsp.inlay_hint.enable(not vim.lsp.inlay_hint.is_enabled())
end)
