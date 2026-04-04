vim.pack.add({
	"https://github.com/nvim-neotest/nvim-nio",
	"https://github.com/rcarriga/nvim-dap-ui",
	"https://github.com/mfussenegger/nvim-dap",
}, { confirm = false, load = true })

local dap = require("dap")

dap.adapters["lldb-dap"] = {
	type = "executable",
	command = vim.fn.exepath("lldb-dap"),
}

dap.configurations.cpp = {
	{
		name = "Launch File",
		type = "lldb-dap",
		request = "launch",
		program = function()
			return vim.fn.input("Path to executable: ", vim.fn.getcwd() .. "/", "file")
		end,
		cwd = "${workspaceFolder}",
		args = function()
			local input = vim.fn.input("Arguments: ")
			return vim.fn.split(input, " ", true)
		end,
		stopOnEntry = false,
	},
}

dap.configurations.c = dap.configurations.cpp

dap.adapters.python = {
	type = "executable",
	command = vim.fn.getenv("VIRTUAL_ENV") and (vim.fn.getenv("VIRTUAL_ENV") .. "/bin/python") or vim.fn.exepath("python3"),
	args = { "-m", "debugpy.adapter" },
}

dap.configurations.python = {
	{
		type = "python",
		request = "launch",
		name = "Launch Python File",
		program = "${file}",
		pythonPath = function()
			local venv = os.getenv("VIRTUAL_ENV")
			if venv then
				return venv .. "/bin/python"
			end

			return vim.fn.exepath("python3") or "python3"
		end,
	},
}

local dapui = require("dapui")
dapui.setup()

dap.listeners.after.event_initialized["dapui_config"] = function()
	dapui.open()
end
dap.listeners.before.event_terminated["dapui_config"] = function()
	dapui.close()
end
dap.listeners.before.event_exited["dapui_config"] = function()
	dapui.close()
end
