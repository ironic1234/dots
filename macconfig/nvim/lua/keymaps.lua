-- Leader defines
vim.g.mapleader = " "
vim.g.maplocalleader = " "

-- Telescope keymaps
vim.keymap.set("n", "<leader>ff", function() require("telescope.builtin").find_files() end, { desc = "Telescope find files" })
vim.keymap.set("n", "<leader>fg", function() require("telescope.builtin").live_grep() end, { desc = "Telescope live grep" })
vim.keymap.set("n", "<leader>fb", function() require("telescope.builtin").buffers() end, { desc = "Telescope buffers" })
vim.keymap.set("n", "<leader>fh", function() require("telescope.builtin").help_tags() end, { desc = "Telescope help tags" })

-- Oil keymap
vim.keymap.set("n", "<leader>fo", vim.cmd.Oil, { desc = "Open Oil file manager" })

-- Alpha keymap
vim.keymap.set("n", "<leader>fa", vim.cmd.Alpha, { desc = "Open Alpha dashboard" })

-- StartupTime keymap
vim.keymap.set("n", "<leader>fs", "<Cmd>Lazy profile<CR>", { desc = "Show Lazy profile/Startup time" })

-- Go back to previous file
vim.keymap.set("n", "<leader>gb", "<Cmd>e#<CR>", { desc = "Go to previous buffer" })

-- DAP: Basic controls
vim.keymap.set("n", "<leader>bp", function() require("dap").toggle_breakpoint() end, { desc = "Debug: Toggle breakpoint" })
vim.keymap.set("n", "<leader>bc", function() require("dap").continue() end, { desc = "Debug: Continue" })
vim.keymap.set("n", "<leader>br", function() require("dap").restart() end, { desc = "Debug: Restart" })
vim.keymap.set("n", "<leader>bt", function() require("dap").terminate() end, { desc = "Debug: Terminate" })
vim.keymap.set("n", "<leader>bb", function() require("dap").set_breakpoint(vim.fn.input("Breakpoint condition: ")) end, { desc = "Debug: Set conditional breakpoint" })

-- DAP: Stepping
vim.keymap.set("n", "<leader>bs", function() require("dap").step_over() end, { desc = "Debug: Step over" })
vim.keymap.set("n", "<leader>bi", function() require("dap").step_into() end, { desc = "Debug: Step into" })
vim.keymap.set("n", "<leader>bo", function() require("dap").step_out() end, { desc = "Debug: Step out" })
vim.keymap.set("n", "<leader>bx", function() require("dap").run_to_cursor() end, { desc = "Debug: Run to cursor" })

-- DAP: REPL
vim.keymap.set("n", "<leader>brl", function() require("dap").repl.open() end, { desc = "Debug: Open REPL" })
vim.keymap.set("n", "<leader>brq", function() require("dap").repl.close() end, { desc = "Debug: Close REPL" })

-- DAP: UI toggle
vim.keymap.set("n", "<leader>bu", function() require("dapui").toggle() end, { desc = "Debug: Toggle UI" })

-- Dropbar
vim.keymap.set("n", "<leader>;", function() require("dropbar.api").pick() end, { desc = "Dropbar: Pick symbols in winbar" })
vim.keymap.set("n", "[;", function() require("dropbar.api").goto_context_start() end, { desc = "Dropbar: Go to start of current context" })
vim.keymap.set("n", "];", function() require("dropbar.api").select_next_context() end, { desc = "Dropbar: Select next context" })

-- LSP
vim.keymap.set("n", "gd", function() vim.lsp.buf.definition() end, { desc = "LSP: Go to definition" })
vim.keymap.set("n", "gi", function() vim.lsp.buf.implementation() end, { desc = "LSP: Go to implementation" })
vim.keymap.set("n", "gh", function() vim.lsp.buf.hover() end, { desc = "LSP: Hover documentation" })
vim.keymap.set("n", "gD", function() vim.diagnostic.open_float() end, { desc = "LSP: Open diagnostic float" })
vim.keymap.set("n", "gr", function() vim.lsp.buf.references() end, { desc = "LSP: List references" })
vim.keymap.set("n", "ga", function() vim.lsp.buf.code_action() end, { desc = "LSP: Code actions" })
vim.keymap.set("n", "<leader>l", function() vim.lsp.inlay_hint.enable(not vim.lsp.inlay_hint.is_enabled()) end, { desc = "LSP: Toggle inlay hints" })
