return {
    "catppuccin/nvim",
    name = "catppuccin",
    priority = 1000,
    config = function()
        require("catppuccin").setup({
            transparent_background = true,
            styles = {
                comments = { "italic" },
                conditionals = { "italic" },
                loops = { "italic" },
                functions = { "italic" },
                properties = { "italic" },
                types = { "italic" },
            },
            integrations = {
                treesitter = true,
            },
        })
    end,
}
