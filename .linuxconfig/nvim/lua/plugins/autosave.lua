return {
	"okuuva/auto-save.nvim",
	cmd = "ASToggle",
	event = { "InsertLeave", "TextChanged" },
	config = function()
		require("auto-save").setup()
	end,
}
