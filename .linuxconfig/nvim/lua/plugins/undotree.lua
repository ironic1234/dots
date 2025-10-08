return {
    "jiaoshijie/undotree",
    dependencies = { "nvim-lua/plenary.nvim" },
    lazy = true,
    config = function()
        require("undotree").setup()
    end,
}
