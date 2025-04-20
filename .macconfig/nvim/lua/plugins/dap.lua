return {
	"mfussenegger/nvim-dap",
	dependencies = {
		"nvim-neotest/nvim-nio",
		"rcarriga/nvim-dap-ui",
	},
	config = function()
		local dap = require("dap")

		-- Adapter: lldb-dap (from Homebrew LLVM)
		dap.adapters["lldb-dap"] = {
			type = "executable",
			command = "/opt/homebrew/opt/llvm/bin/lldb-dap",
			name = "lldb-dap",
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
				stopOnEntry = false,
			},
		}
		dap.configurations.c = dap.configurations.cpp

		-- Adapter: Python with debugpy using virtualenv Python
		dap.adapters.python = {
			type = "executable",
			command = vim.fn.getenv("VIRTUAL_ENV") and (vim.fn.getenv("VIRTUAL_ENV") .. "/bin/python")
				or vim.fn.exepath("python3"),
			args = { "-m", "debugpy.adapter" },
		}

		dap.configurations.python = {
			{
				type = "python",
				request = "launch",
				name = "Launch Python File",
				program = "${file}",
				pythonPath = function()
					-- Use VIRTUAL_ENV/bin/python if it exists
					local venv = os.getenv("VIRTUAL_ENV")
					if venv then
						return venv .. "/bin/python"
					else
						return vim.fn.exepath("python3") or "python3"
					end
				end,
			},
		}

		-- Optional: dap-ui setup
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
	end,
}
