return {
    -- Mason setup
    {
        "williamboman/mason.nvim",
        event = { "BufReadPre", "BufNewFile" },
        config = function()
            require("mason").setup()
        end,
    },

    -- Mason LSP Config setup
    {
        "williamboman/mason-lspconfig.nvim",
        dependencies = { "williamboman/mason.nvim" },
        event = { "BufReadPre", "BufNewFile" },
        config = function()
            require("mason-lspconfig").setup({
                ensure_installed = { "pyright", "gopls", "texlab", "clangd", "svelte", "ts_ls", "lua_ls", "jsonls" },
            })
        end,
    },

    -- Mason Conform setup
    {
        "zapling/mason-conform.nvim",
        event = { "BufReadPre", "BufNewFile" },
        config = function()
            require("mason-conform").setup({
                ensure_installed = { "prettier", "stylua", "black", "clang-format", "latexindent" },
            })
        end,
    },

    -- LSP configuration
    {
        "neovim/nvim-lspconfig",
        dependencies = { "williamboman/mason-lspconfig.nvim" },
        event = { "BufReadPre", "BufNewFile" },
        config = function()
            local lspconfig = require("lspconfig")
            local servers = { "pyright", "gopls", "texlab", "clangd", "svelte", "ts_ls", "lua_ls", "jsonls" }

            -- Specify how the border looks like
            local border = {
                { "┌", "FloatBorder" },
                { "─", "FloatBorder" },
                { "┐", "FloatBorder" },
                { "│", "FloatBorder" },
                { "┘", "FloatBorder" },
                { "─", "FloatBorder" },
                { "└", "FloatBorder" },
                { "│", "FloatBorder" },
            }

            local on_attach = function()
                -- Override open_floating_preview for global hover settings
                local orig_floating_preview = vim.lsp.util.open_floating_preview

                vim.lsp.util.open_floating_preview = function(contents, syntax, opts, ...)
                    opts = opts or {}
                    opts.border = border -- Set border style
                    opts.max_width = 80 -- Set max width
                    opts.max_height = 20 -- Set max height
                    return orig_floating_preview(contents, syntax, opts, ...)
                end

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
            end

            -- Add border to the diagnostic popup window
            vim.diagnostic.config({
                virtual_text = {
                    prefix = "■ ", -- Could be '●', '▎', 'x', '■', , 
                },
                float = {
                    border = border,
                },
            })

            for _, server in ipairs(servers) do
                lspconfig[server].setup({
                    on_attach = on_attach,
                })
            end
        end,
    },

    {
        "folke/lazydev.nvim",
        ft = "lua",
        opts = {
            library = {
                { path = "luvit-meta/library", words = { "vim%.uv" } },
            },
        },
    },

    {
        "Bilal2453/luvit-meta",
        lazy = true,
    },

    -- Completion plugins
    {
        "hrsh7th/nvim-cmp",
        dependencies = {
            "hrsh7th/cmp-nvim-lsp",
            "hrsh7th/cmp-buffer",
            "hrsh7th/cmp-path",
            "hrsh7th/cmp-cmdline",
            "saadparwaiz1/cmp_luasnip",
            "L3MON4D3/LuaSnip",
        },
        event = { "BufReadPre", "BufNewFile" },
        config = function()
            local cmp_autopairs = require("nvim-autopairs.completion.cmp")
            local cmp = require("cmp")
            cmp.event:on("confirm_done", cmp_autopairs.on_confirm_done())
            cmp.setup({
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
                    ["<CR>"] = cmp.mapping.confirm({ select = true }),
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
                    { name = "nvim_lsp" },
                    { name = "luasnip" },
                    { name = "lazydev", group_index = 0 },
                }, {
                    { name = "buffer" },
                }),
            })
        end,
    },

    -- LuaSnip setup
    {
        "L3MON4D3/LuaSnip",
        event = { "BufReadPre", "BufNewFile" },
        config = function()
            require("luasnip.loaders.from_vscode").lazy_load()
        end,
        dependencies = { "rafamadriz/friendly-snippets" },
    },

    -- Auto-format and user command setup
    {
        "stevearc/conform.nvim",
        event = { "BufReadPre", "BufNewFile" },
        config = function()
            require("conform").setup({
                formatters_by_ft = {
                    html = { "prettier" },
                    lua = { "stylua" },
                    python = { "black" },
                    cpp = { "clang-format" },
                    c = { "clang-format" },
                    css = { "prettier" },
                    tex = { "latexindent" },
                    svelte = { "prettier" },
                },
            })
            -- Format command
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
                vim.lsp.buf.format()
            end, { range = true })

            -- Auto-format on save
            vim.api.nvim_create_autocmd("BufWritePre", {
                pattern = "*",
                callback = function(args)
                    require("conform").format({ bufnr = args.buf })
                    vim.lsp.buf.format()
                end,
            })
        end,
    },
    {
        "numToStr/comment.nvim",
        config = function()
            require("Comment").setup()
        end,
    },
}
