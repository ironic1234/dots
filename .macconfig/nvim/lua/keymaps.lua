-- Leader defines
vim.g.mapleader = " "
vim.g.maplocalleader = " "

-- Telescope keymaps
local builtin = require("telescope.builtin")
vim.keymap.set("n", "<leader>ff", builtin.find_files, { desc = "Telescope find files" })
vim.keymap.set("n", "<leader>fg", builtin.live_grep, { desc = "Telescope live grep" })
vim.keymap.set("n", "<leader>fb", builtin.buffers, { desc = "Telescope buffers" })
vim.keymap.set("n", "<leader>fh", builtin.help_tags, { desc = "Telescope help tags" })

-- Oil keymap
vim.keymap.set("n", "<leader>fo", vim.cmd.Oil, { desc = "Open Oil file manager" })

-- Alpha keymap
vim.keymap.set("n", "<leader>fa", vim.cmd.Alpha, { desc = "Open Alpha dashboard" })

-- StartupTime keymap
vim.keymap.set("n", "<leader>fs", "<Cmd>Lazy profile<CR>", { desc = "Show Lazy profile/Startup time" })

-- Go back to previous file
vim.keymap.set("n", "<leader>gb", "<Cmd>e#<CR>", { desc = "Go to previous buffer" })

-- Duck
vim.keymap.set("n", "<leader>cc", function()
	require("duck").hatch("🐈")
end, { desc = "Hatch a duck (cat)" })
vim.keymap.set("n", "<leader>ck", function()
	require("duck").cook()
end, { desc = "Cook a duck" })
vim.keymap.set("n", "<leader>ca", function()
	require("duck").cook_all()
end, { desc = "Cook all ducks" })

local dap = require("dap")

-- DAP: Basic controls
vim.keymap.set("n", "<leader>bp", dap.toggle_breakpoint, { desc = "Debug: Toggle breakpoint" })
vim.keymap.set("n", "<leader>bc", dap.continue, { desc = "Debug: Continue" })
vim.keymap.set("n", "<leader>br", dap.restart, { desc = "Debug: Restart" })
vim.keymap.set("n", "<leader>bt", dap.terminate, { desc = "Debug: Terminate" })
vim.keymap.set("n", "<leader>bb", function()
	dap.set_breakpoint(vim.fn.input("Breakpoint condition: "))
end, { desc = "Debug: Set conditional breakpoint" })

-- DAP: Stepping
vim.keymap.set("n", "<leader>bs", dap.step_over, { desc = "Debug: Step over" })
vim.keymap.set("n", "<leader>bi", dap.step_into, { desc = "Debug: Step into" })
vim.keymap.set("n", "<leader>bo", dap.step_out, { desc = "Debug: Step out" })
vim.keymap.set("n", "<leader>bx", dap.run_to_cursor, { desc = "Debug: Run to cursor" })

-- DAP: REPL
vim.keymap.set("n", "<leader>brl", dap.repl.open, { desc = "Debug: Open REPL" })
vim.keymap.set("n", "<leader>brq", dap.repl.close, { desc = "Debug: Close REPL" })

-- DAP: UI toggle
local dapui_ok, dapui = pcall(require, "dapui")
if dapui_ok then
	vim.keymap.set("n", "<leader>bu", dapui.toggle, { desc = "Debug: Toggle UI" })
end

-- Dropbar
local dropbar_api = require("dropbar.api")
vim.keymap.set("n", "<leader>;", dropbar_api.pick, { desc = "Dropbar: Pick symbols in winbar" })
vim.keymap.set("n", "[;", dropbar_api.goto_context_start, { desc = "Dropbar: Go to start of current context" })
vim.keymap.set("n", "];", dropbar_api.select_next_context, { desc = "Dropbar: Select next context" })

-- LSP
vim.keymap.set("n", "gd", function()
	vim.lsp.buf.definition()
end, { desc = "LSP: Go to definition" })
vim.keymap.set("n", "gi", function()
	vim.lsp.buf.implementation()
end, { desc = "LSP: Go to implementation" })
vim.keymap.set("n", "gh", function()
	vim.lsp.buf.hover()
end, { desc = "LSP: Hover documentation" })
vim.keymap.set("n", "gD", function()
	vim.diagnostic.open_float()
end, { desc = "LSP: Open diagnostic float" })
vim.keymap.set("n", "gr", function()
	vim.lsp.buf.references()
end, { desc = "LSP: List references" })
vim.keymap.set("n", "ga", function()
	vim.lsp.buf.code_action()
end, { desc = "LSP: Code actions" })
vim.keymap.set("n", "<leader>l", function()
	vim.lsp.inlay_hint.enable(not vim.lsp.inlay_hint.is_enabled())
end, { desc = "LSP: Toggle inlay hints" })
