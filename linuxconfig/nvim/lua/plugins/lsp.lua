vim.pack.add({
	"https://github.com/neovim/nvim-lspconfig",
	"https://github.com/folke/lazydev.nvim",
	"https://git.sr.ht/~whynothugo/lsp_lines.nvim",
	"https://github.com/Bilal2453/luvit-meta",
	"https://github.com/hrsh7th/cmp-nvim-lsp",
	"https://github.com/hrsh7th/cmp-buffer",
	"https://github.com/hrsh7th/cmp-path",
	"https://github.com/hrsh7th/cmp-cmdline",
	"https://github.com/saadparwaiz1/cmp_luasnip",
	"https://github.com/L3MON4D3/LuaSnip",
	"https://github.com/rafamadriz/friendly-snippets",
	"https://github.com/hrsh7th/nvim-cmp",
	"https://github.com/stevearc/conform.nvim",
}, { confirm = false, load = true })

local servers = {
	"pylsp",
	"gopls",
	"clangd",
	"lua_ls",
	"rust_analyzer",
	"ty",
}

local on_attach = function()
	local orig_floating_preview = vim.lsp.util.open_floating_preview

	---@diagnostic disable-next-line: duplicate-set-field
	vim.lsp.util.open_floating_preview = function(contents, syntax, opts, ...)
		opts = opts or {}
		opts.max_width = 80
		opts.max_height = 20
		return orig_floating_preview(contents, syntax, opts, ...)
	end

	vim.lsp.inlay_hint.enable(true)
end

vim.diagnostic.config({
	virtual_text = false,
	virtual_lines = true,
})

for _, server in ipairs(servers) do
	if server == "pylsp" then
		vim.lsp.config.pylsp = {
			on_attach = on_attach,
			settings = {
				pylsp = {
					plugins = {
						pyflakes = { enabled = true },
					},
				},
			},
		}
		vim.lsp.enable("pylsp")
	elseif server == "lua_ls" then
		vim.lsp.config.lua_ls = {
			on_attach = on_attach,
			settings = {
				Lua = {
					hint = {
						enable = true,
						setType = true,
						paramType = true,
						paramName = "All",
						semicolon = "Disable",
						arrayIndex = "Enable",
					},
				},
			},
		}
		vim.lsp.enable("lua_ls")
	elseif server == "ty" then
		vim.lsp.enable("ty")
	else
		vim.lsp.config[server] = {
			on_attach = on_attach,
		}
		vim.lsp.enable(server)
	end
end

require("lazydev").setup({
	library = {
		{ path = "luvit-meta/library", words = { "vim%.uv" } },
	},
})

require("lsp_lines").setup({})

local cmp_autopairs = require("nvim-autopairs.completion.cmp")
local cmp = require("cmp")
cmp.event:on("confirm_done", cmp_autopairs.on_confirm_done())
cmp.setup({
	preselect = cmp.PreselectMode.None,
	snippet = {
		expand = function(args)
			require("luasnip").lsp_expand(args.body)
		end,
	},
	mapping = {
		["<C-b>"] = cmp.mapping(cmp.mapping.scroll_docs(-4), { "i", "c" }),
		["<C-f>"] = cmp.mapping(cmp.mapping.scroll_docs(4), { "i", "c" }),
		["<C-Space>"] = cmp.mapping(cmp.mapping.complete(), { "i", "c" }),
		["<C-e>"] = cmp.mapping({
			i = cmp.mapping.abort(),
			c = cmp.mapping.close(),
		}),
		["<CR>"] = cmp.mapping.confirm({ select = false }),
		["<Tab>"] = cmp.mapping(function(fallback)
			if cmp.visible() then
				cmp.select_next_item()
			elseif require("luasnip").expand_or_jumpable() then
				require("luasnip").expand_or_jump()
			else
				fallback()
			end
		end, { "i", "s" }),
		["<S-Tab>"] = cmp.mapping(function(fallback)
			if cmp.visible() then
				cmp.select_prev_item()
			elseif require("luasnip").jumpable(-1) then
				require("luasnip").jump(-1)
			else
				fallback()
			end
		end, { "i", "s" }),
	},
	window = {
		completion = cmp.config.window.bordered(),
		documentation = cmp.config.window.bordered(),
	},
	sources = cmp.config.sources({
		{ name = "copilot" },
		{ name = "nvim_lsp" },
		{ name = "luasnip" },
		{ name = "lazydev", group_index = 0 },
		{ name = "path" },
	}, {
		{ name = "buffer" },
	}),
})

require("luasnip.loaders.from_vscode").lazy_load()

require("conform").setup({
	formatters_by_ft = {
		html = { "prettier" },
		lua = { "stylua" },
		css = { "prettier" },
		htmldjango = { "prettier" },
		c = { "clang-format" },
		cpp = { "clang-format" },
		rust = { "rustfmt" },
		json = { "fixjson" },
	},
})

vim.api.nvim_create_user_command("Format", function(args)
	local range = nil
	if args.count ~= -1 then
		local end_line = vim.api.nvim_buf_get_lines(0, args.line2 - 1, args.line2, true)[1]
		range = {
			start = { args.line1, 0 },
			["end"] = { args.line2, end_line:len() },
		}
	end
	require("conform").format({ async = true, lsp_fallback = true, range = range })
end, { range = true })

vim.api.nvim_create_autocmd("BufWritePre", {
	pattern = "*",
	callback = function(args)
		require("conform").format({ bufnr = args.buf })
	end,
})
