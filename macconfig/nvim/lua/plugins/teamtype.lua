vim.pack.add({ "https://github.com/teamtype/teamtype-nvim" }, { confirm = false, load = true })
vim.keymap.set("n", "<leader>j", "<cmd>TeamtypeJumpToCursor<cr>")
