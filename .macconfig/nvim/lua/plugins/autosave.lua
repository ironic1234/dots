return {
	"0x00-ketsu/autosave.nvim",
	event = { "InsertLeave", "TextChanged" },
	config = function()
		require("autosave").setup({
			enable = true,
			prompt_style = "stdout",
			prompt_message = function()
				return "Autosave: saved at " .. vim.fn.strftime("%H:%M:%S")
			end,
			events = { "InsertLeave", "TextChanged" },
		})
	end,
}

