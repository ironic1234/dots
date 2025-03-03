return {
	"nullromo/go-up.nvim",
	opts = {},
	config = function(_, opts)
		local goUp = require("go-up")
		goUp.setup(opts)
	end,
}
